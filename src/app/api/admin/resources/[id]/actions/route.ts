import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/guards";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { resourceActionSchema } from "@/lib/validation";
import { canSubmitForReview, canDecideReview, canSchedule, canPublishNow, canArchive, canRollback } from "@/lib/content/workflow";

/**
 * SCR-008's workflow action bar — same shape as Blog's own actions route.
 * Resources also gets the §13.1 self-publish exception, same as Blog.
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
  const parsed = resourceActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }
  const input = parsed.data;

  const resource = await prisma.resource.findUnique({ where: { id } });
  if (!resource) return NextResponse.json({ error: "Resource not found." }, { status: 404 });

  const effective = await getEffectivePermissions(adminUser.id);

  async function denyIfMissing(action: string): Promise<NextResponse | null> {
    if (hasPermission(effective, "resources", action)) return null;
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: `resources:${action}`,
      result: "DENIED",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }

  if (input.action === "submit") {
    const denied = await denyIfMissing("submit");
    if (denied) return denied;

    const version = resource.currentVersionId ? await prisma.resourceVersion.findUnique({ where: { id: resource.currentVersionId } }) : null;
    // Resources have no block/feature list to count — "content present" is
    // the guard, standing in for canSubmitForReview's block-count check.
    const translations = version?.translations as { en?: { title?: string } } | undefined;
    const hasContent = Boolean(translations?.en?.title);
    const guard = canSubmitForReview(resource.status, hasContent ? 1 : 0);
    if (!guard.ok) return NextResponse.json({ error: guard.error === "Add at least one content block before submitting for review." ? "Fill in the English title and description before submitting for review." : guard.error }, { status: 409 });

    const updated = await prisma.resource.update({
      where: { id },
      data: { status: "SUBMITTED", submittedByUserId: adminUser.id, reviewComment: null },
    });
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "resources.submit",
      resourceType: "Resource",
      resourceId: id,
      before: { status: resource.status },
      after: { status: "SUBMITTED" },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", resource: updated });
  }

  if (input.action === "approve" || input.action === "requestChanges") {
    // Independent permissions — resources:approve and
    // resources:requestChanges are the same string as the action name.
    const denied = await denyIfMissing(input.action);
    if (denied) return denied;

    const guard = canDecideReview(resource.status, resource.submittedByUserId, adminUser.id);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

    const decision = input.action === "approve" ? "APPROVE" : "REQUEST_CHANGES";
    const nextStatus = input.action === "approve" ? "APPROVED" : "CHANGES_REQUESTED";
    const comment = input.action === "requestChanges" ? input.comment : null;

    const [, updated] = await prisma.$transaction([
      prisma.approval.create({
        data: { resourceType: "Resource", resourceId: id, actorId: adminUser.id, decision, comment },
      }),
      prisma.resource.update({
        where: { id },
        data: {
          status: nextStatus,
          reviewComment: comment,
          submittedByUserId: input.action === "requestChanges" ? null : resource.submittedByUserId,
        },
      }),
    ]);

    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: input.action === "approve" ? "resources.approve" : "resources.request_changes",
      resourceType: "Resource",
      resourceId: id,
      before: { status: resource.status },
      after: { status: nextStatus, comment },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", resource: updated });
  }

  if (input.action === "schedule") {
    const denied = await denyIfMissing("schedule");
    if (denied) return denied;

    const guard = canSchedule(resource.status, input.scheduledFor);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

    const [, updated] = await prisma.$transaction([
      prisma.scheduledPublication.create({
        data: { resourceType: "Resource", resourceId: id, scheduledFor: input.scheduledFor, createdByUserId: adminUser.id },
      }),
      prisma.resource.update({ where: { id }, data: { status: "SCHEDULED" } }),
    ]);

    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "resources.schedule",
      resourceType: "Resource",
      resourceId: id,
      before: { status: resource.status },
      after: { status: "SCHEDULED", scheduledFor: input.scheduledFor.toISOString() },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", resource: updated });
  }

  if (input.action === "publish") {
    const denied = await denyIfMissing("publish");
    if (denied) return denied;

    const guard = canPublishNow(resource.status);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });
    if (!resource.currentVersionId) return NextResponse.json({ error: "Resource has no content to publish." }, { status: 409 });

    const now = new Date();
    const [, updated] = await prisma.$transaction([
      prisma.resourceVersion.update({
        where: { id: resource.currentVersionId },
        data: { publishedAt: now, publishedByUserId: adminUser.id },
      }),
      prisma.resource.update({ where: { id }, data: { status: "PUBLISHED" } }),
    ]);

    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "resources.publish",
      resourceType: "Resource",
      resourceId: id,
      before: { status: resource.status },
      after: { status: "PUBLISHED" },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", resource: updated });
  }

  if (input.action === "archive") {
    const denied = await denyIfMissing("archive");
    if (denied) return denied;

    const guard = canArchive(resource.status);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

    const updated = await prisma.resource.update({ where: { id }, data: { status: "ARCHIVED" } });
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "resources.archive",
      resourceType: "Resource",
      resourceId: id,
      before: { status: resource.status },
      after: { status: "ARCHIVED" },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", resource: updated });
  }

  // rollback
  const denied = await denyIfMissing("rollback");
  if (denied) return denied;

  const targetVersion = await prisma.resourceVersion.findFirst({ where: { id: input.versionId, resourceId: id } });
  if (!targetVersion) return NextResponse.json({ error: "Version not found." }, { status: 404 });

  const hasPublishedVersion = await prisma.resourceVersion.findFirst({ where: { resourceId: id, publishedAt: { not: null } } });
  const guard = canRollback(hasPublishedVersion !== null);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

  const latest = await prisma.resourceVersion.findFirst({ where: { resourceId: id }, orderBy: { versionNumber: "desc" } });
  const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;

  const updated = await prisma.$transaction(async (tx) => {
    const version = await tx.resourceVersion.create({
      data: {
        resourceId: id,
        versionNumber: nextVersionNumber,
        translations: targetVersion.translations as object,
        createdByUserId: adminUser.id,
      },
    });
    return tx.resource.update({
      where: { id },
      data: { currentVersionId: version.id, status: "DRAFT", submittedByUserId: null, reviewComment: null },
    });
  });

  await recordAudit({
    actorId: adminUser.id,
    actorEmail: adminUser.email,
    action: "resources.rollback",
    resourceType: "Resource",
    resourceId: id,
    before: { status: resource.status },
    after: { status: "DRAFT", rolledBackToVersion: targetVersion.versionNumber, newVersion: nextVersionNumber },
    result: "SUCCESS",
    ipAddress,
    sessionId: session.id,
  });
  return NextResponse.json({ status: "success", resource: updated });
}
