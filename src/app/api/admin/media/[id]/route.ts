import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { updateMediaMetadataSchema, mediaMetadataSchema } from "@/lib/validation";
import { saveMediaFile, extractImageMetadata, deleteMediaFile } from "@/lib/media/storage";
import { findMediaAssetUsage } from "@/lib/media/usage";

/** SCR-026 Media Asset Detail. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "media", "view");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) return NextResponse.json({ error: "Asset not found." }, { status: 404 });

  return NextResponse.json({ asset });
}

/**
 * Two distinct operations behind one route, distinguished by
 * Content-Type: a JSON body edits metadata (altText/caption/folder/tags/
 * archived); multipart/form-data with a `file` field is §18's "Replace
 * Asset" — swaps the underlying file while the asset's id (and every
 * existing reference to it) stays the same. Replace requires
 * `confirmReplace: "true"` when the asset has live usage, mirroring
 * §18's "confirmation step showing the usage list, since this affects
 * live content" — the usage list itself is what the client already
 * fetched from GET .../usage to show that confirmation.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "media", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const existing = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Asset not found." }, { status: 404 });

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "A replacement file is required." }, { status: 400 });
    }

    const usage = await findMediaAssetUsage(id);
    if (usage.length > 0 && formData.get("confirmReplace") !== "true") {
      return NextResponse.json({ error: "This asset is in use. Confirm replacement.", usage }, { status: 409 });
    }

    const stored = await saveMediaFile(file);
    const imageMeta = await extractImageMetadata(file, stored.storageKey);
    await deleteMediaFile(existing.url, existing.responsiveDerivatives as { width: number; url: string }[] | null);

    const updated = await prisma.mediaAsset.update({
      where: { id },
      data: {
        filename: file.name,
        url: stored.url,
        fileType: file.type || "application/octet-stream",
        fileSize: file.size,
        width: imageMeta.width,
        height: imageMeta.height,
        responsiveDerivatives: imageMeta.responsiveDerivatives as unknown as Prisma.InputJsonValue | undefined,
      },
    });

    await recordAudit({
      actorId: auth.context.adminUser.id,
      actorEmail: auth.context.adminUser.email,
      action: "media.replace",
      resourceType: "MediaAsset",
      resourceId: id,
      before: { filename: existing.filename, url: existing.url },
      after: { filename: updated.filename, url: updated.url },
      result: "SUCCESS",
      ipAddress,
      sessionId: auth.context.session.id,
    });

    return NextResponse.json({ status: "success", asset: updated });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = updateMediaMetadataSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid values.", issues: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.altText !== undefined) {
    const altTextCheck = mediaMetadataSchema.shape.altText.safeParse(parsed.data.altText);
    if (!altTextCheck.success) {
      return NextResponse.json({ error: "Alt text cannot be empty." }, { status: 400 });
    }
  }

  // Archiving/unarchiving is a distinct, higher-blast-radius action from
  // plain metadata edits (§8: Media Manager+ only) — gated separately
  // even though it shares this route with ordinary caption/tag edits.
  if (parsed.data.archived !== undefined && !auth.context.effective.permissions.has("media:archive")) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }

  const updated = await prisma.mediaAsset.update({ where: { id }, data: parsed.data });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "media.update",
    resourceType: "MediaAsset",
    resourceId: id,
    before: { altText: existing.altText, caption: existing.caption, folder: existing.folder, tags: existing.tags, archived: existing.archived },
    after: parsed.data,
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", asset: updated });
}

/** §18: "Deletion... is blocked entirely while any usage reference exists." */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "media", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const existing = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Asset not found." }, { status: 404 });

  const usage = await findMediaAssetUsage(id);
  if (usage.length > 0) {
    return NextResponse.json({ error: "This asset is referenced by existing content and cannot be deleted.", usage }, { status: 409 });
  }

  await deleteMediaFile(existing.url, existing.responsiveDerivatives as { width: number; url: string }[] | null);
  await prisma.mediaAsset.delete({ where: { id } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "media.delete",
    resourceType: "MediaAsset",
    resourceId: id,
    before: { filename: existing.filename, altText: existing.altText },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
