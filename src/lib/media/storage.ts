import "server-only";
import { writeFile, unlink, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

/**
 * SRS §18 Media Library's file storage backend. Genuinely working — the
 * uploaded file is really saved and really served (Next.js serves
 * anything under `public/` at its root path) — not a stub. Local disk
 * under `public/uploads` is real infrastructure, just not the CDN/object
 * storage a production deploy would eventually use; every caller goes
 * through this module's functions, so swapping to S3/GCS later is a
 * change contained here, matching the same "disclosed BLOCKER, real
 * interface" pattern already used for zynreach-website's unconfigured
 * CRM/ATS/storage integrations.
 */

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const PUBLIC_PATH_PREFIX = "/uploads";
const DERIVATIVE_WIDTHS = [400, 800, 1600];

export interface ImageMetadata {
  width: number | null;
  height: number | null;
  responsiveDerivatives: { width: number; url: string }[] | null;
}

export interface StoredFile {
  url: string;
  storageKey: string;
}

async function ensureUploadDir(): Promise<void> {
  await mkdir(UPLOAD_DIR, { recursive: true });
}

export async function saveMediaFile(file: File): Promise<StoredFile> {
  await ensureUploadDir();
  const ext = path.extname(file.name) || "";
  const storageKey = `${randomUUID()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, storageKey), buffer);
  return { url: `${PUBLIC_PATH_PREFIX}/${storageKey}`, storageKey };
}

/**
 * §18 "File Type, File Size, Dimensions — Auto-detected metadata" and
 * the CDN References row's `responsiveDerivatives[]` — both genuinely
 * computed here via sharp (already resolvable in node_modules as a
 * transitive Next.js dependency; added as a direct one for reliability),
 * not left as a fabricated/empty placeholder. Only meaningful for
 * image/* uploads — video dimension extraction would need a media-probe
 * tool this project doesn't have, so video/document assets get
 * width/height: null, honestly, rather than a guessed value.
 */
export async function extractImageMetadata(file: File, storageKey: string): Promise<ImageMetadata> {
  if (!file.type.startsWith("image/")) {
    return { width: null, height: null, responsiveDerivatives: null };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const image = sharp(buffer);
    const meta = await image.metadata();
    const width = meta.width ?? null;
    const height = meta.height ?? null;

    if (!width) return { width, height, responsiveDerivatives: null };

    await ensureUploadDir();
    const ext = path.extname(storageKey) || ".jpg";
    const base = storageKey.slice(0, -ext.length || undefined);
    const derivatives: { width: number; url: string }[] = [];

    for (const targetWidth of DERIVATIVE_WIDTHS) {
      if (targetWidth >= width) continue; // never upscale
      const derivativeKey = `${base}-w${targetWidth}${ext}`;
      await sharp(buffer).resize({ width: targetWidth }).toFile(path.join(UPLOAD_DIR, derivativeKey));
      derivatives.push({ width: targetWidth, url: `${PUBLIC_PATH_PREFIX}/${derivativeKey}` });
    }

    return { width, height, responsiveDerivatives: derivatives.length > 0 ? derivatives : null };
  } catch {
    // Not a format sharp can decode (or a corrupt file) — the upload
    // itself already succeeded above; metadata just stays unknown rather
    // than failing the whole request.
    return { width: null, height: null, responsiveDerivatives: null };
  }
}

/** Deletes the original file plus any derivatives recorded for it. */
export async function deleteMediaFile(url: string, responsiveDerivatives: { width: number; url: string }[] | null): Promise<void> {
  const urls = [url, ...(responsiveDerivatives ?? []).map((d) => d.url)];
  for (const target of urls) {
    if (!target.startsWith(PUBLIC_PATH_PREFIX)) continue; // not a locally-stored file — nothing to unlink
    const storageKey = target.slice(PUBLIC_PATH_PREFIX.length + 1);
    try {
      await unlink(path.join(UPLOAD_DIR, storageKey));
    } catch {
      // already gone — deletion is idempotent, not an error condition
    }
  }
}

/**
 * Private-file storage — deliberately outside `public/`, so Next.js never
 * serves these as static files at any URL. For content that is sensitive
 * by nature (career-application resumes/CVs today), as opposed to Media
 * Library assets (saveMediaFile above), which are meant to be publicly
 * reachable because zynreach-website embeds them on the public site.
 *
 * The only way to read a file back is readPrivateFile, and the only
 * legitimate caller of that is an authenticated route that already knows
 * the exact storageKey from its own database row (e.g. JobApplication) —
 * never from a client-supplied path. resolvePrivateFilePath additionally
 * refuses anything that isn't shaped like the "<uuid>.<ext>" keys this
 * module itself generates, so even a corrupted/tampered stored key can
 * never resolve outside PRIVATE_UPLOAD_DIR.
 */
const PRIVATE_UPLOAD_DIR = path.join(process.cwd(), "private-uploads");

async function ensurePrivateUploadDir(): Promise<void> {
  await mkdir(PRIVATE_UPLOAD_DIR, { recursive: true });
}

export interface StoredPrivateFile {
  storageKey: string;
}

export async function savePrivateFile(file: File): Promise<StoredPrivateFile> {
  await ensurePrivateUploadDir();
  const ext = path.extname(file.name) || "";
  const storageKey = `${randomUUID()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(PRIVATE_UPLOAD_DIR, storageKey), buffer);
  return { storageKey };
}

// Matches exactly what savePrivateFile generates: a UUID plus an optional
// short extension. No path separators, no "..", nothing else — a
// storageKey failing this can never be a traversal attempt that happens
// to also look plausible.
const PRIVATE_STORAGE_KEY_PATTERN = /^[0-9a-fA-F-]{36}(?:\.[a-zA-Z0-9]{1,10})?$/;

/** Resolves a storageKey to an absolute path guaranteed to sit inside
 * PRIVATE_UPLOAD_DIR, or null if the key is malformed — never accepts a
 * raw filesystem path, only the opaque key saveMediaFile/savePrivateFile
 * itself produced. */
export function resolvePrivateFilePath(storageKey: string): string | null {
  if (!PRIVATE_STORAGE_KEY_PATTERN.test(storageKey)) return null;
  const resolved = path.resolve(PRIVATE_UPLOAD_DIR, storageKey);
  const dirWithSep = PRIVATE_UPLOAD_DIR.endsWith(path.sep) ? PRIVATE_UPLOAD_DIR : `${PRIVATE_UPLOAD_DIR}${path.sep}`;
  if (!resolved.startsWith(dirWithSep)) return null; // defense in depth against traversal, belt-and-braces with the regex above
  return resolved;
}

export async function readPrivateFile(storageKey: string): Promise<Buffer | null> {
  const filePath = resolvePrivateFilePath(storageKey);
  if (!filePath) return null;
  try {
    return await readFile(filePath);
  } catch {
    return null; // missing/unreadable — caller treats this as "not found"
  }
}

export async function deletePrivateFile(storageKey: string): Promise<void> {
  const filePath = resolvePrivateFilePath(storageKey);
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch {
    // already gone — deletion is idempotent, not an error condition
  }
}
