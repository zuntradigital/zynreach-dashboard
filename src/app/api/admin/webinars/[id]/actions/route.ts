import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/guards";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { webinarActionSchema } from "@/lib/validation";
import { canSubmitForReview, canDecideReview, canSchedule, canPublishNow, canArchive, canRollback } from "@/lib/content/workflow";
import { notifySubscribers } from "@/lib/notifications/dispatch";

/**
 * Knowledge Center §9's workflow action bar — same shape as Blog/
 * Resources' own actions routes, reusing the exact same workflow.ts
 * guards. Webinars also gets the §13.1 self-publish exception, same as
 * Blog/Resources.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const { adminUser, session } = sessionResult.context;
  const ipAddress = getClientIp(request);

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = webinarActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }
  const input = parsed.data;

  const webinar = await prisma.webinar.findUnique({ where: { id } });
  if (!webinar) return NextResponse.json({ error: "Webinar not found." }, { status: 404 });

  const effective = await getEffectivePermissions(adminUser.id);

  async function denyIfMissing(action: string): Promise<NextResponse | null> {
    if (hasPermission(effective, "webinars", action)) return null;
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: `webinars:${action}`,
      result: "DENIED",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }

  if (input.action === "submit") {
    const denied = await denyIfMissing("submit");
    if (denied) return denied;

    const version = webinar.currentVersionId ? await prisma.webinarVersion.findUnique({ where: { id: webinar.currentVersionId } }) : null;
    // Webinars have no block/feature list to count — "content present" is
    // the guard, standing in for canSubmitForReview's block-count check.
    const translations = version?.translations as { en?: { title?: string } } | undefined;
    const hasContent = Boolean(translations?.en?.title);
    const guard = canSubmitForReview(webinar.status, hasContent ? 1 : 0);
    if (!guard.ok) return NextResponse.json({ error: guard.error === "Add at least one content block before submitting for review." ? "Fill in the English title and description before submitting for review." : guard.error }, { status: 409 });

    const updated = await prisma.webinar.update({
      where: { id },
      data: { status: "SUBMITTED", submittedByUserId: adminUser.id, reviewComment: null },
    });
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "webinars.submit",
      resourceType: "Webinar",
      resourceId: id,
      before: { status: webinar.status },
      after: { status: "SUBMITTED" },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", webinar: updated });
  }

  if (input.action === "approve" || input.action === "requestChanges") {
    // Independent permissions — webinars:approve and
    // webinars:requestChanges are the same string as the action name.
    const denied = await denyIfMissing(input.action);
    if (denied) return denied;

    const guard = canDecideReview(webinar.status, webinar.submittedByUserId, adminUser.id);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

    const decision = input.action === "approve" ? "APPROVE" : "REQUEST_CHANGES";
    const nextStatus = input.action === "approve" ? "APPROVED" : "CHANGES_REQUESTED";
    const comment = input.action === "requestChanges" ? input.comment : null;

    const [, updated] = await prisma.$transaction([
      prisma.approval.create({
        data: { resourceType: "Webinar", resourceId: id, actorId: adminUser.id, decision, comment },
      }),
      prisma.webinar.update({
        where: { id },
        data: {
          status: nextStatus,
          reviewComment: comment,
          submittedByUserId: input.action === "requestChanges" ? null : webinar.submittedByUserId,
        },
      }),
    ]);

    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: input.action === "approve" ? "webinars.approve" : "webinars.request_changes",
      resourceType: "Webinar",
      resourceId: id,
      before: { status: webinar.status },
      after: { status: nextStatus, comment },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", webinar: updated });
  }

  if (input.action === "schedule") {
    const denied = await denyIfMissing("schedule");
    if (denied) return denied;

    const guard = canSchedule(webinar.status, input.scheduledFor);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

    const [, updated] = await prisma.$transaction([
      prisma.scheduledPublication.create({
        data: { resourceType: "Webinar", resourceId: id, scheduledFor: input.scheduledFor, createdByUserId: adminUser.id },
      }),
      prisma.webinar.update({ where: { id }, data: { status: "SCHEDULED" } }),
    ]);

    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "webinars.schedule",
      resourceType: "Webinar",
      resourceId: id,
      before: { status: webinar.status },
      after: { status: "SCHEDULED", scheduledFor: input.scheduledFor.toISOString() },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", webinar: updated });
  }

  if (input.action === "publish") {
    const denied = await denyIfMissing("publish");
    if (denied) return denied;

    const guard = canPublishNow(webinar.status);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });
    if (!webinar.currentVersionId) return NextResponse.json({ error: "Webinar has no content to publish." }, { status: 409 });

    const now = new Date();
    const [, updated] = await prisma.$transaction([
      prisma.webinarVersion.update({
        where: { id: webinar.currentVersionId },
        data: { publishedAt: now, publishedByUserId: adminUser.id },
      }),
      prisma.webinar.update({ where: { id }, data: { status: "PUBLISHED" } }),
    ]);

    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "webinars.publish",
      resourceType: "Webinar",
      resourceId: id,
      before: { status: webinar.status },
      after: { status: "PUBLISHED" },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });

    if (webinar.currentVersionId) {
      const version = await prisma.webinarVersion.findUnique({ where: { id: webinar.currentVersionId }, select: { translations: true } });
      const title = (version?.translations as { en?: { title?: string } } | undefined)?.en?.title;
      const base = process.env.NEXT_PUBLIC_WEBSITE_URL || "https://www.zynreach.com";
      if (title) {
        notifySubscribers({ category: "WEBINARS", title, url: `${base}/en/webinars/${webinar.slug}` }).catch(() => undefined);
      }
    }

    return NextResponse.json({ status: "success", webinar: updated });
  }

  if (input.action === "archive") {
    const denied = await denyIfMissing("archive");
    if (denied) return denied;

    const guard = canArchive(webinar.status);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

    const updated = await prisma.webinar.update({ where: { id }, data: { status: "ARCHIVED" } });
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "webinars.archive",
      resourceType: "Webinar",
      resourceId: id,
      before: { status: webinar.status },
      after: { status: "ARCHIVED" },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", webinar: updated });
  }

  // rollback
  const denied = await denyIfMissing("rollback");
  if (denied) return denied;

  const targetVersion = await prisma.webinarVersion.findFirst({ where: { id: input.versionId, webinarId: id } });
  if (!targetVersion) return NextResponse.json({ error: "Version not found." }, { status: 404 });

  const hasPublishedVersion = await prisma.webinarVersion.findFirst({ where: { webinarId: id, publishedAt: { not: null } } });
  const guard = canRollback(hasPublishedVersion !== null);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

  const latest = await prisma.webinarVersion.findFirst({ where: { webinarId: id }, orderBy: { versionNumber: "desc" } });
  const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;

  const updated = await prisma.$transaction(async (tx) => {
    const version = await tx.webinarVersion.create({
      data: {
        webinarId: id,
        versionNumber: nextVersionNumber,
        scheduledAt: targetVersion.scheduledAt,
        durationMinutes: targetVersion.durationMinutes,
        isOnDemand: targetVersion.isOnDemand,
        videoUrl: targetVersion.videoUrl,
        speakerPhotoId: targetVersion.speakerPhotoId,
        translations: targetVersion.translations as object,
        createdByUserId: adminUser.id,
      },
    });
    return tx.webinar.update({
      where: { id },
      data: { currentVersionId: version.id, status: "DRAFT", submittedByUserId: null, reviewComment: null },
    });
  });

  await recordAudit({
    actorId: adminUser.id,
    actorEmail: adminUser.email,
    action: "webinars.rollback",
    resourceType: "Webinar",
    resourceId: id,
    before: { status: webinar.status },
    after: { status: "DRAFT", rolledBackToVersion: targetVersion.versionNumber, newVersion: nextVersionNumber },
    result: "SUCCESS",
    ipAddress,
    sessionId: session.id,
  });
  return NextResponse.json({ status: "success", webinar: updated });
}
