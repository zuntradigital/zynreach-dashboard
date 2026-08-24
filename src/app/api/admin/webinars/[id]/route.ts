import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { saveWebinarVersionSchema } from "@/lib/validation";

/** Knowledge Center §9 Webinar Editor load: webinar, version history, Approval trail. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "webinars", "view");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const webinar = await prisma.webinar.findUnique({
    where: { id },
    include: {
      currentVersion: { include: { speakerPhoto: true } },
      versions: { orderBy: { versionNumber: "desc" } },
    },
  });
  if (!webinar) return NextResponse.json({ error: "Webinar not found." }, { status: 404 });

  const [approvals, scheduledPublications] = await Promise.all([
    prisma.approval.findMany({
      where: { resourceType: "Webinar", resourceId: id },
      orderBy: { decidedAt: "desc" },
      include: { actor: { select: { name: true, email: true } } },
    }),
    prisma.scheduledPublication.findMany({
      where: { resourceType: "Webinar", resourceId: id },
      orderBy: { createdAt: "desc" },
      take: 1,
    }),
  ]);

  return NextResponse.json({ webinar: { ...webinar, approvals, scheduledPublications } });
}

/**
 * Webinar Save — intentionally bypasses the governed Draft -> Submit ->
 * Approve -> Publish workflow that Pages/Resources still use, same as
 * Blog (see that PATCH handler's docstring for the full reasoning).
 * Business requirement: the admin explicitly picks the webinar's live
 * status (Draft, Published, or Archived) on every save, and that decision
 * must take effect immediately — no separate publish/archive step.
 * Creates a NEW WebinarVersion (still immutable, matching every other
 * *Version model) and writes the chosen status straight onto
 * Webinar.status in the same transaction; publishedAt is stamped only
 * when the chosen status is PUBLISHED. The public webinar API reads
 * Webinar.status/currentVersion directly (not "last published version"),
 * so Draft/Archived really do take a webinar offline immediately, and
 * Published really does put the edited content live immediately.
 *
 * Two publish-time rules are enforced here, not just hidden in the UI
 * (§17 "Publishing permissions and validation must be enforced at the
 * actual backend/API authorization level"):
 *  - webinars:publish gate — an actor who only holds webinars:edit can
 *    still create/edit/save a webinar, but a PUBLISHED choice from them is
 *    silently coerced to DRAFT rather than rejected, so their other edits
 *    aren't lost; the webinar simply stays unavailable until an actor who
 *    holds webinars:publish publishes it. Same reasoning covers
 *    speakerPhotoId: a request from a non-publisher can never add/change
 *    the speaker photo, so it's pinned to whatever the current version
 *    already has.
 *  - Completeness gate — an actor who *does* hold webinars:publish still
 *    can't publish unless both locales have a title, description, and
 *    speaker name; this one is a hard 400 (not a silent coercion) naming
 *    exactly what's missing, since a would-be publisher acting on
 *    incomplete content is a mistake to surface, not a permission
 *    boundary to work around quietly. Unlike Blog, there is no image
 *    requirement — a webinar with no speaker photo yet is still
 *    publishable.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "webinars", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const webinar = await prisma.webinar.findUnique({ where: { id }, include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } });
  if (!webinar) return NextResponse.json({ error: "Webinar not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = saveWebinarVersionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid webinar values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const {
    status: requestedStatus,
    gated,
    featured,
    scheduledAt,
    durationMinutes,
    isOnDemand,
    videoUrl,
    category,
    speakerPhotoId: requestedSpeakerPhotoId,
    translations,
  } = parsed.data;

  const canPublish = hasPermission(auth.context.effective, "webinars", "publish");
  const canArchive = hasPermission(auth.context.effective, "webinars", "archive");
  const existingSpeakerPhotoId = webinar.versions[0]?.speakerPhotoId ?? null;
  const speakerPhotoId = canPublish ? requestedSpeakerPhotoId : existingSpeakerPhotoId;

  let status = requestedStatus;
  let coercedFromPublish = false;
  if (requestedStatus === "PUBLISHED") {
    if (!canPublish) {
      status = "DRAFT";
      coercedFromPublish = true;
    } else {
      const missing: ("en" | "ar")[] = [];
      // Title/description/speakerName are only required at publish time
      // (not for every Draft autosave) — a live public webinar needs all
      // three, but an in-progress Draft shouldn't be blocked from saving
      // just because the admin hasn't typed a title yet.
      if (!translations.en.title.trim() || !translations.en.description.trim() || !translations.en.speakerName.trim()) missing.push("en");
      if (!translations.ar.title.trim() || !translations.ar.description.trim() || !translations.ar.speakerName.trim()) missing.push("ar");
      if (missing.length > 0) {
        return NextResponse.json({ error: "Cannot publish — required content is missing.", missing }, { status: 400 });
      }
    }
  } else if (requestedStatus === "ARCHIVED" && !canArchive) {
    // Same silent-coercion pattern as the Publish gate above — Archive is
    // an independent permission from Edit/Publish; an actor with Edit but
    // not Archive can still save other changes, they just can't move the
    // webinar to Archived.
    status = "DRAFT";
  }

  const nextVersionNumber = (webinar.versions[0]?.versionNumber ?? 0) + 1;
  const now = new Date();
  const publishing = status === "PUBLISHED";

  const updated = await prisma.$transaction(async (tx) => {
    const version = await tx.webinarVersion.create({
      data: {
        webinarId: webinar.id,
        versionNumber: nextVersionNumber,
        scheduledAt,
        durationMinutes,
        isOnDemand,
        videoUrl,
        category,
        speakerPhotoId,
        translations: translations as unknown as Prisma.InputJsonValue,
        createdByUserId: auth.context.adminUser.id,
        publishedAt: publishing ? now : null,
        publishedByUserId: publishing ? auth.context.adminUser.id : null,
      },
    });
    return tx.webinar.update({
      where: { id: webinar.id },
      data: { currentVersionId: version.id, status, gated, featured, submittedByUserId: null, reviewComment: null },
      include: { currentVersion: { include: { speakerPhoto: true } } },
    });
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "webinars.save",
    resourceType: "Webinar",
    resourceId: webinar.id,
    before: { status: webinar.status },
    after: { status, versionNumber: nextVersionNumber },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", webinar: updated, coercedFromPublish });
}

/**
 * Delete — always available (no status/everPublished gate the way the
 * old governed workflow enforced), matching Blog/Resources' "Delete"
 * model. Nothing else has an FK depending on a Webinar's identity
 * (WebinarVersion cascades with it), so a real hard delete is always
 * safe here.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "webinars", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const webinar = await prisma.webinar.findUnique({ where: { id } });
  if (!webinar) return NextResponse.json({ error: "Webinar not found." }, { status: 404 });

  await prisma.webinar.delete({ where: { id } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "webinars.delete",
    resourceType: "Webinar",
    resourceId: id,
    before: { slug: webinar.slug, status: webinar.status },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
