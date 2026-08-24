import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/guards";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { customerStoryActionSchema } from "@/lib/validation";
import { canSubmitForReview, canDecideReview, canSchedule, canPublishNow, canArchive, canRollback } from "@/lib/content/workflow";

/**
 * Customer Story workflow action bar — same shape as Blog's actions route,
 * reusing the exact same workflow.ts guards. Coexists with the direct-save
 * PATCH handler (see that route's own docstring) for actors who prefer the
 * formal Submit -> Approve -> Publish path over picking a status directly.
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
  const parsed = customerStoryActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }
  const input = parsed.data;

  const story = await prisma.customerStory.findUnique({ where: { id } });
  if (!story) return NextResponse.json({ error: "Customer story not found." }, { status: 404 });

  const effective = await getEffectivePermissions(adminUser.id);

  async function denyIfMissing(action: string): Promise<NextResponse | null> {
    if (hasPermission(effective, "customerStories", action)) return null;
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: `customerStories:${action}`,
      result: "DENIED",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }

  if (input.action === "submit") {
    const denied = await denyIfMissing("submit");
    if (denied) return denied;

    const version = story.currentVersionId ? await prisma.customerStoryVersion.findUnique({ where: { id: story.currentVersionId } }) : null;
    const translations = version?.translations as { en?: { challenge?: string } } | undefined;
    const blockCount = translations?.en?.challenge?.trim() ? 1 : 0;
    const guard = canSubmitForReview(story.status, blockCount);
    if (!guard.ok) return NextResponse.json({ error: guard.error === "Add at least one content block before submitting for review." ? "Fill in the English challenge/solution/results before submitting for review." : guard.error }, { status: 409 });

    const updated = await prisma.customerStory.update({
      where: { id },
      data: { status: "SUBMITTED", submittedByUserId: adminUser.id, reviewComment: null },
    });
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "customerStories.submit",
      resourceType: "CustomerStory",
      resourceId: id,
      before: { status: story.status },
      after: { status: "SUBMITTED" },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", story: updated });
  }

  if (input.action === "approve" || input.action === "requestChanges") {
    const denied = await denyIfMissing(input.action);
    if (denied) return denied;

    const guard = canDecideReview(story.status, story.submittedByUserId, adminUser.id);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

    const decision = input.action === "approve" ? "APPROVE" : "REQUEST_CHANGES";
    const nextStatus = input.action === "approve" ? "APPROVED" : "CHANGES_REQUESTED";
    const comment = input.action === "requestChanges" ? input.comment : null;

    const [, updated] = await prisma.$transaction([
      prisma.approval.create({
        data: { resourceType: "CustomerStory", resourceId: id, actorId: adminUser.id, decision, comment },
      }),
      prisma.customerStory.update({
        where: { id },
        data: {
          status: nextStatus,
          reviewComment: comment,
          submittedByUserId: input.action === "requestChanges" ? null : story.submittedByUserId,
        },
      }),
    ]);

    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: input.action === "approve" ? "customerStories.approve" : "customerStories.request_changes",
      resourceType: "CustomerStory",
      resourceId: id,
      before: { status: story.status },
      after: { status: nextStatus, comment },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", story: updated });
  }

  if (input.action === "schedule") {
    const denied = await denyIfMissing("schedule");
    if (denied) return denied;

    const guard = canSchedule(story.status, input.scheduledFor);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

    const [, updated] = await prisma.$transaction([
      prisma.scheduledPublication.create({
        data: { resourceType: "CustomerStory", resourceId: id, scheduledFor: input.scheduledFor, createdByUserId: adminUser.id },
      }),
      prisma.customerStory.update({ where: { id }, data: { status: "SCHEDULED" } }),
    ]);

    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "customerStories.schedule",
      resourceType: "CustomerStory",
      resourceId: id,
      before: { status: story.status },
      after: { status: "SCHEDULED", scheduledFor: input.scheduledFor.toISOString() },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", story: updated });
  }

  if (input.action === "publish") {
    const denied = await denyIfMissing("publish");
    if (denied) return denied;

    const guard = canPublishNow(story.status);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });
    if (!story.currentVersionId) return NextResponse.json({ error: "Story has no content to publish." }, { status: 409 });

    const now = new Date();
    const [, updated] = await prisma.$transaction([
      prisma.customerStoryVersion.update({
        where: { id: story.currentVersionId },
        data: { publishedAt: now, publishedByUserId: adminUser.id },
      }),
      prisma.customerStory.update({ where: { id }, data: { status: "PUBLISHED" } }),
    ]);

    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "customerStories.publish",
      resourceType: "CustomerStory",
      resourceId: id,
      before: { status: story.status },
      after: { status: "PUBLISHED" },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", story: updated });
  }

  if (input.action === "archive") {
    const denied = await denyIfMissing("archive");
    if (denied) return denied;

    const guard = canArchive(story.status);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

    const updated = await prisma.customerStory.update({ where: { id }, data: { status: "ARCHIVED" } });
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "customerStories.archive",
      resourceType: "CustomerStory",
      resourceId: id,
      before: { status: story.status },
      after: { status: "ARCHIVED" },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", story: updated });
  }

  // rollback
  const denied = await denyIfMissing("rollback");
  if (denied) return denied;

  const targetVersion = await prisma.customerStoryVersion.findFirst({ where: { id: input.versionId, customerStoryId: id } });
  if (!targetVersion) return NextResponse.json({ error: "Version not found." }, { status: 404 });

  const hasPublishedVersion = await prisma.customerStoryVersion.findFirst({ where: { customerStoryId: id, publishedAt: { not: null } } });
  const guard = canRollback(hasPublishedVersion !== null);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

  const latest = await prisma.customerStoryVersion.findFirst({ where: { customerStoryId: id }, orderBy: { versionNumber: "desc" } });
  const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;

  const updated = await prisma.$transaction(async (tx) => {
    const version = await tx.customerStoryVersion.create({
      data: {
        customerStoryId: id,
        versionNumber: nextVersionNumber,
        testimonialName: targetVersion.testimonialName,
        testimonialTitle: targetVersion.testimonialTitle,
        testimonialCompany: targetVersion.testimonialCompany,
        testimonialPhotoId: targetVersion.testimonialPhotoId,
        relatedCapabilitySlugs: targetVersion.relatedCapabilitySlugs as string[],
        translations: targetVersion.translations as object,
        createdByUserId: adminUser.id,
      },
    });
    return tx.customerStory.update({
      where: { id },
      data: { currentVersionId: version.id, status: "DRAFT", submittedByUserId: null, reviewComment: null },
    });
  });

  await recordAudit({
    actorId: adminUser.id,
    actorEmail: adminUser.email,
    action: "customerStories.rollback",
    resourceType: "CustomerStory",
    resourceId: id,
    before: { status: story.status },
    after: { status: "DRAFT", rolledBackToVersion: targetVersion.versionNumber, newVersion: nextVersionNumber },
    result: "SUCCESS",
    ipAddress,
    sessionId: session.id,
  });
  return NextResponse.json({ status: "success", story: updated });
}
