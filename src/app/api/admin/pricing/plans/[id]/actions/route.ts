import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth/guards";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { pricingActionSchema } from "@/lib/validation";
import { canSubmitForReview, canDecideReview, canSchedule, canPublishNow, canArchive, canRollback } from "@/lib/content/workflow";

/**
 * SCR-021's workflow action bar — same shape as the Pages actions route
 * (Submit for Review / Approve / Request Changes / Schedule / Publish /
 * Archive / Rollback), reusing the exact same workflow.ts guards (they
 * operate on primitive ContentStatus values, not Page-shaped objects, so
 * nothing there needed to change for a second governed content type).
 * Pricing has no Legal-style stricter-reviewer carve-out (§13.3 doesn't
 * apply), so unlike Pages this never branches into a "reviewLegal"
 * permission — plain pricing:review covers every Approve decision.
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
  const parsed = pricingActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }
  const input = parsed.data;

  const plan = await prisma.pricingPlan.findUnique({ where: { id } });
  if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

  const effective = await getEffectivePermissions(adminUser.id);

  async function denyIfMissing(action: string): Promise<NextResponse | null> {
    if (hasPermission(effective, "pricing", action)) return null;
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: `pricing:${action}`,
      result: "DENIED",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }

  if (input.action === "submit") {
    const denied = await denyIfMissing("edit");
    if (denied) return denied;

    const version = plan.currentVersionId ? await prisma.pricingVersion.findUnique({ where: { id: plan.currentVersionId }, include: { features: true } }) : null;
    // Pricing's own "at least one Feature" requirement (§32) stands in
    // for canSubmitForReview's block-count check — same guard function,
    // a feature count instead of a component-block count.
    const featureCount = version?.features.length ?? 0;
    const guard = canSubmitForReview(plan.status, featureCount);
    if (!guard.ok) return NextResponse.json({ error: "Add at least one comparison feature before submitting for review." }, { status: 409 });
    if (!version || (version.monthlyPrice === null) !== (version.annualPrice === null)) {
      return NextResponse.json({ error: "Set both Monthly and Annual price, or leave both blank for a custom-quote plan." }, { status: 409 });
    }

    const updated = await prisma.pricingPlan.update({
      where: { id },
      data: { status: "SUBMITTED", submittedByUserId: adminUser.id, reviewComment: null },
    });
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "pricing.submit",
      resourceType: "PricingPlan",
      resourceId: id,
      before: { status: plan.status },
      after: { status: "SUBMITTED" },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", plan: updated });
  }

  if (input.action === "approve" || input.action === "requestChanges") {
    const denied = await denyIfMissing("review");
    if (denied) return denied;

    const guard = canDecideReview(plan.status, plan.submittedByUserId, adminUser.id);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

    const decision = input.action === "approve" ? "APPROVE" : "REQUEST_CHANGES";
    const nextStatus = input.action === "approve" ? "APPROVED" : "CHANGES_REQUESTED";
    const comment = input.action === "requestChanges" ? input.comment : null;

    const [, updated] = await prisma.$transaction([
      prisma.approval.create({
        data: { resourceType: "PricingPlan", resourceId: id, actorId: adminUser.id, decision, comment },
      }),
      prisma.pricingPlan.update({
        where: { id },
        data: {
          status: nextStatus,
          reviewComment: comment,
          submittedByUserId: input.action === "requestChanges" ? null : plan.submittedByUserId,
        },
      }),
    ]);

    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: input.action === "approve" ? "pricing.approve" : "pricing.request_changes",
      resourceType: "PricingPlan",
      resourceId: id,
      before: { status: plan.status },
      after: { status: nextStatus, comment },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", plan: updated });
  }

  if (input.action === "schedule") {
    const denied = await denyIfMissing("publish");
    if (denied) return denied;

    const guard = canSchedule(plan.status, input.scheduledFor);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

    const [, updated] = await prisma.$transaction([
      prisma.scheduledPublication.create({
        data: { resourceType: "PricingPlan", resourceId: id, scheduledFor: input.scheduledFor, createdByUserId: adminUser.id },
      }),
      prisma.pricingPlan.update({ where: { id }, data: { status: "SCHEDULED" } }),
    ]);

    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "pricing.schedule",
      resourceType: "PricingPlan",
      resourceId: id,
      before: { status: plan.status },
      after: { status: "SCHEDULED", scheduledFor: input.scheduledFor.toISOString() },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", plan: updated });
  }

  if (input.action === "publish") {
    const denied = await denyIfMissing("publish");
    if (denied) return denied;

    const guard = canPublishNow(plan.status);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });
    if (!plan.currentVersionId) return NextResponse.json({ error: "Plan has no content to publish." }, { status: 409 });

    const now = new Date();
    const [, updated] = await prisma.$transaction([
      prisma.pricingVersion.update({
        where: { id: plan.currentVersionId },
        data: { publishedAt: now, publishedByUserId: adminUser.id },
      }),
      prisma.pricingPlan.update({ where: { id }, data: { status: "PUBLISHED" } }),
    ]);

    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "pricing.publish",
      resourceType: "PricingPlan",
      resourceId: id,
      before: { status: plan.status },
      after: { status: "PUBLISHED" },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", plan: updated });
  }

  if (input.action === "archive") {
    const denied = await denyIfMissing("publish");
    if (denied) return denied;

    const guard = canArchive(plan.status);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

    const updated = await prisma.pricingPlan.update({ where: { id }, data: { status: "ARCHIVED" } });
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "pricing.archive",
      resourceType: "PricingPlan",
      resourceId: id,
      before: { status: plan.status },
      after: { status: "ARCHIVED" },
      result: "SUCCESS",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ status: "success", plan: updated });
  }

  // rollback
  const denied = await denyIfMissing("edit");
  if (denied) return denied;

  const targetVersion = await prisma.pricingVersion.findFirst({ where: { id: input.versionId, pricingPlanId: id }, include: { features: true } });
  if (!targetVersion) return NextResponse.json({ error: "Version not found." }, { status: 404 });

  const hasPublishedVersion = await prisma.pricingVersion.findFirst({ where: { pricingPlanId: id, publishedAt: { not: null } } });
  const guard = canRollback(hasPublishedVersion !== null);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

  const latest = await prisma.pricingVersion.findFirst({ where: { pricingPlanId: id }, orderBy: { versionNumber: "desc" } });
  const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;

  const updated = await prisma.$transaction(async (tx) => {
    const version = await tx.pricingVersion.create({
      data: {
        pricingPlanId: id,
        versionNumber: nextVersionNumber,
        monthlyPrice: targetVersion.monthlyPrice,
        annualPrice: targetVersion.annualPrice,
        currency: targetVersion.currency,
        trialPeriodDays: targetVersion.trialPeriodDays,
        ctaTarget: targetVersion.ctaTarget,
        effectiveDate: targetVersion.effectiveDate,
        expirationDate: targetVersion.expirationDate,
        translations: targetVersion.translations as object,
        createdByUserId: adminUser.id,
        features: { create: targetVersion.features.map((f) => ({ pricingFeatureId: f.pricingFeatureId, value: f.value })) },
      },
    });
    return tx.pricingPlan.update({
      where: { id },
      data: { currentVersionId: version.id, status: "DRAFT", submittedByUserId: null, reviewComment: null },
    });
  });

  await recordAudit({
    actorId: adminUser.id,
    actorEmail: adminUser.email,
    action: "pricing.rollback",
    resourceType: "PricingPlan",
    resourceId: id,
    before: { status: plan.status },
    after: { status: "DRAFT", rolledBackToVersion: targetVersion.versionNumber, newVersion: nextVersionNumber },
    result: "SUCCESS",
    ipAddress,
    sessionId: session.id,
  });
  return NextResponse.json({ status: "success", plan: updated });
}
