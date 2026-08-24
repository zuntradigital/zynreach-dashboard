import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { mediaMetadataSchema, mediaQuerySchema } from "@/lib/validation";
import { saveMediaFile, extractImageMetadata } from "@/lib/media/storage";
import { applyWatermark } from "@/lib/media/image-watermark";

/** SCR-025 Media Library Grid — search/filter per §18's table. */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "media", "view");
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const parsed = mediaQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }
  const { search, tag, fileType, folder, dateFrom, dateTo, archived, page, take } = parsed.data;

  const where: Prisma.MediaAssetWhereInput = {
    ...(archived === "all" ? {} : { archived: archived === "true" }),
    // `tags` is a JSON string array (MySQL/Prisma has no array scalar type
    // — see MediaAsset.tags' schema comment); `array_contains` is the JSON
    // equivalent of the array `has` filter Postgres's native array type
    // supported directly.
    ...(tag ? { tags: { array_contains: tag } } : {}),
    ...(fileType ? { fileType } : {}),
    ...(folder ? { folder } : {}),
    ...(dateFrom || dateTo
      ? { createdAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } }
      : {}),
    // No `mode: "insensitive"` — that option is Postgres/MongoDB-only in
    // Prisma. MySQL's default utf8mb4 collation is already
    // case-insensitive, so a plain `contains` filter preserves the same
    // case-insensitive search behavior without it.
    ...(search
      ? {
          OR: [{ filename: { contains: search } }, { altText: { contains: search } }],
        }
      : {}),
  };

  const [assets, total] = await Promise.all([
    prisma.mediaAsset.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * take,
      take,
    }),
    prisma.mediaAsset.count({ where }),
  ]);

  return NextResponse.json({ assets, total, page, take });
}

/**
 * SCR-027 Media Upload Modal. multipart/form-data — `file` plus §18's
 * metadata fields. Alt text is validated before the file is even saved
 * to disk, so a rejected upload never leaves an orphaned file behind.
 */
export async function POST(request: Request) {
  const auth = await requirePermission(request, "media", "upload");
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "A file is required." }, { status: 400 });
  }

  const tagsRaw = formData.get("tags");
  let tags: string[] = [];
  if (typeof tagsRaw === "string" && tagsRaw.trim()) {
    try {
      tags = JSON.parse(tagsRaw);
    } catch {
      tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
    }
  }

  const parsed = mediaMetadataSchema.safeParse({
    altText: formData.get("altText"),
    caption: formData.get("caption") || undefined,
    folder: formData.get("folder") || undefined,
    tags,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Alt text is required.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { altText, caption, folder } = parsed.data;

  // Opt-in per upload call site (see MediaPicker's `applyWatermark` prop) —
  // the ZynReach logo-over-image treatment used on the public website's
  // article images, applied here so it's baked into the stored file rather
  // than composited at render time. Only meaningful for images; a
  // non-image upload with the flag set is stored unchanged.
  const watermarkRequested = formData.get("watermark") === "true";
  let fileToStore: File = file;
  if (watermarkRequested && file.type.startsWith("image/")) {
    const watermarkedBuffer = await applyWatermark(Buffer.from(await file.arrayBuffer()));
    fileToStore = new File([new Uint8Array(watermarkedBuffer)], file.name, { type: file.type });
  }

  const stored = await saveMediaFile(fileToStore);
  const imageMeta = await extractImageMetadata(fileToStore, stored.storageKey);

  const asset = await prisma.mediaAsset.create({
    data: {
      filename: file.name,
      url: stored.url,
      altText,
      caption,
      fileType: file.type || "application/octet-stream",
      fileSize: fileToStore.size,
      width: imageMeta.width,
      height: imageMeta.height,
      folder,
      tags: parsed.data.tags,
      responsiveDerivatives: imageMeta.responsiveDerivatives as unknown as Prisma.InputJsonValue | undefined,
      uploadedByUserId: auth.context.adminUser.id,
    },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "media.upload",
    resourceType: "MediaAsset",
    resourceId: asset.id,
    after: { filename: asset.filename, altText: asset.altText, fileType: asset.fileType, fileSize: asset.fileSize },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", asset }, { status: 201 });
}
