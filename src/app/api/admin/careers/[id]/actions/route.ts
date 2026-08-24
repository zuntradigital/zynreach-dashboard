import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/guards";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { jobListingActionSchema } from "@/lib/validation";
import { canSubmitForReview, canDecideReview, canSchedule, canPublishNow, canArchive, canRollback } from "@/lib/content/workflow";

/**
 * SCR-015's workflow action bar — same shape as Blog/Resources' own
 * actions routes. Content Manager may self-publish here too (§13.1's
 * exception applies the same way it does for Blog/Resources — Careers has
 * no Pricing-style hard "never self-publish" rule).
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
  const parsed = jobListingActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }
  const input = parsed.data;

  const listing = await prisma.jobListing.findUnique({ where: { id } });
  if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });

  const effective = await getEffectivePermissions(adminUser.id);

  async function denyIfMissing(action: string): Promise<NextResponse | null> {
    if (hasPermission(effective, "careers", action)) return null;
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: `careers:${action}`,
      result: "DENIED",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }

  if (input.action === "submit") {
    const denied = await denyIfMissing("submit");
    if (denied) return denied;

    const version = listing.currentVersionId ? await prisma.jobListingVersion.findUnique({ where: { id: listing.currentVersionId } }) : null;
    const translations = version?.translations as { en?: { title?: string } } | undefined;
    const hasContent = Boolean(translations?.en?.title);
    const guard = canSubmitForReview(listing.status, hasContent ? 1 : 0);
    if (!guard.ok) return NextResponse.json({ error: guard.error === "Add at least one content block before submitting for review." ? "Fill in the English title before submitting for review." : guard.error }, { status: 409 });

    const updated = await prisma.jobListing.update({
      where: { id },
      data: { status: "SUBMITTED", submittedByUserId: adminUser.id, reviewComment: null },
    });
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "careers.submit",
      resourceType: "JobListing",
      resourceId: id,
      before: { status: listing.status },
      after: { status: "SUBMITTED" },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", listing: updated });
  }

  if (input.action === "approve" || input.action === "requestChanges") {
    // Independent permissions — careers:approve and careers:requestChanges
    // are the same string as the action name.
    const denied = await denyIfMissing(input.action);
    if (denied) return denied;

    const guard = canDecideReview(listing.status, listing.submittedByUserId, adminUser.id);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

    const decision = input.action === "approve" ? "APPROVE" : "REQUEST_CHANGES";
    const nextStatus = input.action === "approve" ? "APPROVED" : "CHANGES_REQUESTED";
    const comment = input.action === "requestChanges" ? input.comment : null;

    const [, updated] = await prisma.$transaction([
      prisma.approval.create({
        data: { resourceType: "JobListing", resourceId: id, actorId: adminUser.id, decision, comment },
      }),
      prisma.jobListing.update({
        where: { id },
        data: {
          status: nextStatus,
          reviewComment: comment,
          submittedByUserId: input.action === "requestChanges" ? null : listing.submittedByUserId,
        },
      }),
    ]);

    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: input.action === "approve" ? "careers.approve" : "careers.request_changes",
      resourceType: "JobListing",
      resourceId: id,
      before: { status: listing.status },
      after: { status: nextStatus, comment },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", listing: updated });
  }

  if (input.action === "schedule") {
    const denied = await denyIfMissing("schedule");
    if (denied) return denied;

    const guard = canSchedule(listing.status, input.scheduledFor);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

    const [, updated] = await prisma.$transaction([
      prisma.scheduledPublication.create({
        data: { resourceType: "JobListing", resourceId: id, scheduledFor: input.scheduledFor, createdByUserId: adminUser.id },
      }),
      prisma.jobListing.update({ where: { id }, data: { status: "SCHEDULED" } }),
    ]);

    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "careers.schedule",
      resourceType: "JobListing",
      resourceId: id,
      before: { status: listing.status },
      after: { status: "SCHEDULED", scheduledFor: input.scheduledFor.toISOString() },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", listing: updated });
  }

  if (input.action === "publish") {
    const denied = await denyIfMissing("publish");
    if (denied) return denied;

    const guard = canPublishNow(listing.status);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });
    if (!listing.currentVersionId) return NextResponse.json({ error: "Listing has no content to publish." }, { status: 409 });

    const now = new Date();
    const [, updated] = await prisma.$transaction([
      prisma.jobListingVersion.update({
        where: { id: listing.currentVersionId },
        data: { publishedAt: now, publishedByUserId: adminUser.id },
      }),
      prisma.jobListing.update({ where: { id }, data: { status: "PUBLISHED" } }),
    ]);

    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "careers.publish",
      resourceType: "JobListing",
      resourceId: id,
      before: { status: listing.status },
      after: { status: "PUBLISHED" },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", listing: updated });
  }

  if (input.action === "archive") {
    const denied = await denyIfMissing("archive");
    if (denied) return denied;

    const guard = canArchive(listing.status);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

    const updated = await prisma.jobListing.update({ where: { id }, data: { status: "ARCHIVED" } });
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "careers.archive",
      resourceType: "JobListing",
      resourceId: id,
      before: { status: listing.status },
      after: { status: "ARCHIVED" },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", listing: updated });
  }

  // rollback
  const denied = await denyIfMissing("rollback");
  if (denied) return denied;

  const targetVersion = await prisma.jobListingVersion.findFirst({ where: { id: input.versionId, jobListingId: id } });
  if (!targetVersion) return NextResponse.json({ error: "Version not found." }, { status: 404 });

  const hasPublishedVersion = await prisma.jobListingVersion.findFirst({ where: { jobListingId: id, publishedAt: { not: null } } });
  const guard = canRollback(hasPublishedVersion !== null);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

  const latest = await prisma.jobListingVersion.findFirst({ where: { jobListingId: id }, orderBy: { versionNumber: "desc" } });
  const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;

  const updated = await prisma.$transaction(async (tx) => {
    const version = await tx.jobListingVersion.create({
      data: {
        jobListingId: id,
        versionNumber: nextVersionNumber,
        datePosted: targetVersion.datePosted,
        translations: targetVersion.translations as object,
        createdByUserId: adminUser.id,
      },
    });
    return tx.jobListing.update({
      where: { id },
      data: { currentVersionId: version.id, status: "DRAFT", submittedByUserId: null, reviewComment: null },
    });
  });

  await recordAudit({
    actorId: adminUser.id,
    actorEmail: adminUser.email,
    action: "careers.rollback",
    resourceType: "JobListing",
    resourceId: id,
    before: { status: listing.status },
    after: { status: "DRAFT", rolledBackToVersion: targetVersion.versionNumber, newVersion: nextVersionNumber },
    result: "SUCCESS",
    ipAddress,
    sessionId: session.id,
  });
  return NextResponse.json({ status: "success", listing: updated });
}
