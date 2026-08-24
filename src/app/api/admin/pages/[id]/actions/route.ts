import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/guards";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { pageActionSchema } from "@/lib/validation";
import {
  canSubmitForReview,
  canDecideReview,
  requiredReviewPermissionAction,
  canSchedule,
  canPublishNow,
  canArchive,
  canRollback,
} from "@/lib/content/workflow";

/**
 * SCR-003's workflow action bar (Submit for Review / Approve / Request
 * Changes / Schedule / Publish / Archive) and SCR-017's Rollback, as one
 * endpoint rather than seven near-identical route files — each branch
 * needs a *different*, fully independent permission (content:submit,
 * content:approve, content:requestChanges — or content:reviewLegal for
 * Legal/Security-classified pages —, content:schedule, content:publish,
 * content:archive, content:rollback; none of these imply each other),
 * which a fixed-action requirePermission() call can't express before the
 * body is parsed, so this checks permission manually per-branch instead,
 * writing the same DENIED-audit-then-403 shape requirePermission() would
 * have.
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
  const parsed = pageActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }
  const input = parsed.data;

  const page = await prisma.page.findUnique({ where: { id } });
  if (!page) return NextResponse.json({ error: "Page not found." }, { status: 404 });

  const effective = await getEffectivePermissions(adminUser.id);

  async function denyIfMissing(action: string): Promise<NextResponse | null> {
    if (hasPermission(effective, "content", action)) return null;
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: `content:${action}`,
      result: "DENIED",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }

  if (input.action === "submit") {
    const denied = await denyIfMissing("submit");
    if (denied) return denied;

    const version = page.currentVersionId ? await prisma.pageVersion.findUnique({ where: { id: page.currentVersionId } }) : null;
    const blocks = Array.isArray(version?.componentBlocks) ? version.componentBlocks.length : 0;
    const guard = canSubmitForReview(page.status, blocks);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

    const updated = await prisma.page.update({
      where: { id },
      data: { status: "SUBMITTED", submittedByUserId: adminUser.id, reviewComment: null },
    });
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "page.submit",
      resourceType: "Page",
      resourceId: id,
      before: { status: page.status },
      after: { status: "SUBMITTED" },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", page: updated });
  }

  if (input.action === "approve" || input.action === "requestChanges") {
    const requiredAction = requiredReviewPermissionAction(page.classification, input.action);
    const denied = await denyIfMissing(requiredAction);
    if (denied) return denied;

    const guard = canDecideReview(page.status, page.submittedByUserId, adminUser.id);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

    const decision = input.action === "approve" ? "APPROVE" : "REQUEST_CHANGES";
    const nextStatus = input.action === "approve" ? "APPROVED" : "CHANGES_REQUESTED";
    const comment = input.action === "requestChanges" ? input.comment : null;

    const [, updated] = await prisma.$transaction([
      prisma.approval.create({
        data: { resourceType: "Page", resourceId: id, actorId: adminUser.id, decision, comment },
      }),
      prisma.page.update({
        where: { id },
        data: {
          status: nextStatus,
          reviewComment: comment,
          submittedByUserId: input.action === "requestChanges" ? null : page.submittedByUserId,
        },
      }),
    ]);

    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: input.action === "approve" ? "page.approve" : "page.request_changes",
      resourceType: "Page",
      resourceId: id,
      before: { status: page.status },
      after: { status: nextStatus, comment },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", page: updated });
  }

  if (input.action === "schedule") {
    const denied = await denyIfMissing("schedule");
    if (denied) return denied;

    const guard = canSchedule(page.status, input.scheduledFor);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

    const [, updated] = await prisma.$transaction([
      prisma.scheduledPublication.create({
        data: { resourceType: "Page", resourceId: id, scheduledFor: input.scheduledFor, createdByUserId: adminUser.id },
      }),
      prisma.page.update({ where: { id }, data: { status: "SCHEDULED" } }),
    ]);

    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "page.schedule",
      resourceType: "Page",
      resourceId: id,
      before: { status: page.status },
      after: { status: "SCHEDULED", scheduledFor: input.scheduledFor.toISOString() },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", page: updated });
  }

  if (input.action === "publish") {
    const denied = await denyIfMissing("publish");
    if (denied) return denied;

    const guard = canPublishNow(page.status);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });
    if (!page.currentVersionId) return NextResponse.json({ error: "Page has no content to publish." }, { status: 409 });

    const now = new Date();
    const [, updated] = await prisma.$transaction([
      prisma.pageVersion.update({
        where: { id: page.currentVersionId },
        data: { publishedAt: now, publishedByUserId: adminUser.id },
      }),
      prisma.page.update({ where: { id }, data: { status: "PUBLISHED" } }),
    ]);

    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "page.publish",
      resourceType: "Page",
      resourceId: id,
      before: { status: page.status },
      after: { status: "PUBLISHED" },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", page: updated });
  }

  if (input.action === "archive") {
    const denied = await denyIfMissing("archive");
    if (denied) return denied;

    const guard = canArchive(page.status);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

    const updated = await prisma.page.update({ where: { id }, data: { status: "ARCHIVED" } });
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "page.archive",
      resourceType: "Page",
      resourceId: id,
      before: { status: page.status },
      after: { status: "ARCHIVED" },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", page: updated });
  }

  // rollback
  const denied = await denyIfMissing("rollback");
  if (denied) return denied;

  const targetVersion = await prisma.pageVersion.findFirst({ where: { id: input.versionId, pageId: id } });
  if (!targetVersion) return NextResponse.json({ error: "Version not found." }, { status: 404 });

  const hasPublishedVersion = await prisma.pageVersion.findFirst({ where: { pageId: id, publishedAt: { not: null } } });
  const guard = canRollback(hasPublishedVersion !== null);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

  const latest = await prisma.pageVersion.findFirst({ where: { pageId: id }, orderBy: { versionNumber: "desc" } });
  const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;

  const updated = await prisma.$transaction(async (tx) => {
    const version = await tx.pageVersion.create({
      data: {
        pageId: id,
        versionNumber: nextVersionNumber,
        title: targetVersion.title,
        componentBlocks: targetVersion.componentBlocks as object,
        createdByUserId: adminUser.id,
      },
    });
    return tx.page.update({
      where: { id },
      data: { title: targetVersion.title, currentVersionId: version.id, status: "DRAFT", submittedByUserId: null, reviewComment: null },
    });
  });

  await recordAudit({
    actorId: adminUser.id,
    actorEmail: adminUser.email,
    action: "page.rollback",
    resourceType: "Page",
    resourceId: id,
    before: { status: page.status },
    after: { status: "DRAFT", rolledBackToVersion: targetVersion.versionNumber, newVersion: nextVersionNumber },
    result: "SUCCESS",
    ipAddress,
    sessionId: session.id,
  });
  return NextResponse.json({ status: "success", page: updated });
}
