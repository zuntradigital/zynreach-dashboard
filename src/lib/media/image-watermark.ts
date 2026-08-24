import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Sharp, type FormatEnum } from "sharp";

/**
 * Pure image-processing service: overlays the company logo (public/logo-mark.png)
 * onto an image and returns a newly processed buffer. It has no knowledge of
 * uploads, storage providers, or persistence — callers own all of that.
 *
 * Ported verbatim from zynreach-website's src/lib/services/image-watermark.ts
 * (same logo-mark.png asset, byte-identical) — that service documents this
 * exact admin-upload use case as its planned second caller, so this is
 * completing pre-existing, disclosed infrastructure rather than inventing a
 * new logo treatment.
 *
 * Requires the Node.js runtime (not Edge): sharp uses native bindings, and
 * this service reads the fixed watermark asset from local disk (the one
 * filesystem operation it performs — it never reads, writes, or persists the
 * image being watermarked).
 */

export interface WatermarkOptions {
  /** Watermark width as a fraction of the base image's shorter edge, (0, 1]. Default 0.16. */
  scale?: number;
  /**
   * Padding from each edge, as a fraction of that edge's own dimension
   * (right/left padding is a fraction of width; top/bottom padding is a
   * fraction of height), >= 0. Default 0.08.
   *
   * Deliberately edge-relative rather than a single shorter-edge-derived
   * value: many places this asset is displayed crop it to a different
   * aspect ratio than the source (e.g. a fixed-aspect-ratio card via
   * object-cover), which trims from whichever dimension the source
   * disagrees with most. A padding this service can't tune per-caller has
   * to leave enough margin on *both* axes independently to still land
   * inside the visible frame after a plausible crop, not just within the
   * raw source image's own bounds.
   */
  padding?: number;
  /** Watermark opacity, (0, 1]. Default 0.55. */
  opacity?: number;
  /** Output quality for lossy re-encodes (JPEG/WebP), 1-100. Has no effect on lossless formats (e.g. PNG). Default 92. */
  quality?: number;
}

export type WatermarkableImage = Buffer | ArrayBuffer | Uint8Array | Blob | NodeJS.ReadableStream;

const WATERMARK_LOGO_PATH = path.join(process.cwd(), "public", "logo-mark.png");

const DEFAULT_OPTIONS: Required<WatermarkOptions> = {
  scale: 0.16,
  padding: 0.08,
  opacity: 0.55,
  quality: 92,
};

/**
 * Loaded once, at module-initialization time — not on the first
 * `applyWatermark` call — and shared by every ImageWatermarkService
 * instance for the lifetime of the process. `.catch()` here only prevents
 * an unhandled-rejection warning if the read fails before any caller has
 * awaited it; it doesn't swallow the error, which still surfaces to callers
 * because `await watermarkLogoPromise` below re-throws on the same rejected
 * promise.
 */
const watermarkLogoPromise: Promise<Buffer> = readFile(WATERMARK_LOGO_PATH);
watermarkLogoPromise.catch(() => {});

export class ImageWatermarkService {
  private readonly defaults: Required<WatermarkOptions>;

  constructor(options: WatermarkOptions = {}) {
    this.defaults = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Applies the company watermark to `image` and resolves a new Buffer.
   * `image` is never mutated — sharp always reads it and produces separate
   * output bytes.
   */
  async applyWatermark(image: WatermarkableImage, options: WatermarkOptions = {}): Promise<Buffer> {
    const { scale, padding, opacity, quality } = { ...this.defaults, ...options };
    if (!(scale > 0 && scale <= 1)) throw new RangeError("ImageWatermarkService: scale must be within (0, 1].");
    if (!(padding >= 0)) throw new RangeError("ImageWatermarkService: padding must be >= 0.");
    if (!(opacity > 0 && opacity <= 1)) throw new RangeError("ImageWatermarkService: opacity must be within (0, 1].");
    if (!(quality >= 1 && quality <= 100)) throw new RangeError("ImageWatermarkService: quality must be within [1, 100].");

    const sourceBuffer = await toBuffer(image);
    if (sourceBuffer.length === 0) throw new Error("ImageWatermarkService: received an empty image.");

    const metadata = await sharp(sourceBuffer, { failOn: "none" }).metadata();
    const rawWidth = metadata.width;
    const rawHeight = metadata.height;
    if (!rawWidth || !rawHeight) {
      throw new Error("ImageWatermarkService: could not read source image dimensions.");
    }

    // EXIF orientations 5-8 rotate the image 90/270 degrees on display,
    // swapping the effective width/height that `.rotate()` below (auto-orient)
    // will produce. Sizing/positioning the watermark against the raw,
    // pre-rotation dimensions would place it in the wrong corner for any
    // photo carrying one of these tags — the common case for phone-camera
    // portrait shots.
    const isRotated90 = (metadata.orientation ?? 1) >= 5;
    const width = isRotated90 ? rawHeight : rawWidth;
    const height = isRotated90 ? rawWidth : rawHeight;

    const shorterEdge = Math.min(width, height);
    const watermarkTargetWidth = Math.max(1, Math.round(shorterEdge * scale));
    // Edge-relative, not shorter-edge-relative (see WatermarkOptions.padding):
    // each axis gets its own margin proportional to its own dimension.
    const horizontalPaddingPx = Math.max(0, Math.round(width * padding));
    const verticalPaddingPx = Math.max(0, Math.round(height * padding));

    const watermarkLogo = await watermarkLogoPromise;

    const { data: resizedWatermark, info: resizedInfo } = await sharp(watermarkLogo)
      .resize({ width: watermarkTargetWidth })
      .ensureAlpha()
      .png()
      .toBuffer({ resolveWithObject: true });

    // Standard sharp recipe for uniform opacity: composite a 1x1 RGBA tile
    // whose alpha equals the target opacity using the "dest-in" blend mode,
    // which multiplies the destination's existing alpha by the tile's alpha
    // (the tile's RGB is discarded — only its alpha channel is used as a mask).
    const watermarkWithOpacity = await sharp(resizedWatermark)
      .composite([
        {
          input: Buffer.from([255, 255, 255, Math.round(opacity * 255)]),
          raw: { width: 1, height: 1, channels: 4 },
          tile: true,
          blend: "dest-in",
        },
      ])
      .png()
      .toBuffer();

    const left = Math.max(0, width - resizedInfo.width - horizontalPaddingPx);
    const top = Math.max(0, height - resizedInfo.height - verticalPaddingPx);

    const pipeline = sharp(sourceBuffer, { failOn: "none" })
      .rotate() // auto-orient per EXIF, matching the width/height computed above
      .composite([{ input: watermarkWithOpacity, left, top }]);

    return applyOutputFormat(pipeline, metadata.format, quality).toBuffer();
  }
}

/** Re-encodes in the source format at a quality that preserves visual fidelity, instead of sharp's lower re-encode defaults. */
function applyOutputFormat(pipeline: Sharp, format: keyof FormatEnum | undefined, quality: number): Sharp {
  const roundedQuality = Math.round(quality);
  switch (format) {
    case "jpeg":
      return pipeline.jpeg({ quality: roundedQuality });
    case "png":
      return pipeline.png({ compressionLevel: 9 });
    case "webp":
      return pipeline.webp({ quality: roundedQuality });
    case undefined:
      return pipeline;
    default:
      return pipeline.toFormat(format);
  }
}

async function toBuffer(image: WatermarkableImage): Promise<Buffer> {
  if (Buffer.isBuffer(image)) return image;
  if (image instanceof Uint8Array) return Buffer.from(image);
  if (image instanceof ArrayBuffer) return Buffer.from(image);
  if (image instanceof Blob) return Buffer.from(await image.arrayBuffer());
  if (isReadableStream(image)) {
    const chunks: Buffer[] = [];
    for await (const chunk of image) {
      const part = chunk as unknown as Buffer | Uint8Array | string;
      chunks.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
    }
    return Buffer.concat(chunks);
  }
  throw new TypeError("ImageWatermarkService: unsupported image input type.");
}

function isReadableStream(value: unknown): value is NodeJS.ReadableStream {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  );
}

/** Default singleton for callers that don't need per-call watermark tuning. */
export const imageWatermarkService = new ImageWatermarkService();

/** Convenience function form of `imageWatermarkService.applyWatermark`. */
export async function applyWatermark(image: WatermarkableImage, options?: WatermarkOptions): Promise<Buffer> {
  return imageWatermarkService.applyWatermark(image, options);
}
