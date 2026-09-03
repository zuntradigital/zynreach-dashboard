import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { savePricingVersionSchema } from "@/lib/validation";

/** SCR-021 Pricing Plan Editor load: plan, version history, Approval trail. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "pricing", "view");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const plan = await prisma.pricingPlan.findUnique({
    where: { id },
    include: {
      currentVersion: { include: { features: { include: { feature: true } } } },
      versions: { orderBy: { versionNumber: "desc" } },
    },
  });
  if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

  // No DB-level FK (see Approval's schema comment) — same application-
  // level join the Pages detail route already uses.
  const [approvals, scheduledPublications] = await Promise.all([
    prisma.approval.findMany({
      where: { resourceType: "PricingPlan", resourceId: id },
      orderBy: { decidedAt: "desc" },
      include: { actor: { select: { name: true, email: true } } },
    }),
    prisma.scheduledPublication.findMany({
      where: { resourceType: "PricingPlan", resourceId: id },
      orderBy: { createdAt: "desc" },
      take: 1,
    }),
  ]);

  return NextResponse.json({ plan: { ...plan, approvals, scheduledPublications } });
}

/**
 * Pricing Save — intentionally bypasses the governed Draft → Submit →
 * Approve → Publish workflow that Pages/Resources still use. The admin
 * picks the plan's live status (Draft or Published) on every save, and
 * that decision takes effect immediately — no separate publish step.
 * Creates a NEW PricingVersion (immutable snapshot, as before) and writes
 * the chosen status straight onto PricingPlan.status in the same
 * transaction; publishedAt is stamped only when the chosen status is
 * PUBLISHED. The public pricing API reads PricingPlan.status/currentVersion
 * directly, so a Draft choice takes a plan offline immediately too.
 *
 * pricing:publish gate (SRS §13.1/§13.2 — Pricing self-publish by an
 * unauthorized actor is a hard rule violation, not a configurable
 * default): an actor who only holds pricing:edit can still create/edit/
 * save a Draft version, but a PUBLISHED choice from them is silently
 * coerced to DRAFT rather than rejected, so their other edits aren't
 * lost — the plan simply stays unpublished until an actor who holds
 * pricing:publish saves it as Published. Same pattern as the equivalent
 * blog:publish gate in the Blog PATCH route.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "pricing", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const plan = await prisma.pricingPlan.findUnique({ where: { id }, include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } });
  if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = savePricingVersionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid pricing values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const {
    status,
    monthlyPrice,
    annualPrice,
    currency,
    trialPeriodDays,
    includedUsers,
    additionalUserPrice,
    recommended,
    ctaTarget,
    effectiveDate,
    expirationDate,
    translations,
    features,
  } = parsed.data;

  if ((monthlyPrice === null) !== (annualPrice === null)) {
    return NextResponse.json({ error: "Monthly and Annual price must both be set, or both left blank for a custom-quote plan." }, { status: 400 });
  }
  if (expirationDate && effectiveDate && expirationDate <= effectiveDate) {
    return NextResponse.json({ error: "Expiration Date must be after Effective Date." }, { status: 400 });
  }

  if (features.length > 0) {
    const foundFeatures = await prisma.pricingFeature.findMany({ where: { key: { in: features.map((f) => f.featureKey) } } });
    if (foundFeatures.length !== new Set(features.map((f) => f.featureKey)).size) {
      return NextResponse.json({ error: "One or more feature keys do not exist." }, { status: 400 });
    }
  }

  const canPublish = hasPermission(auth.context.effective, "pricing", "publish");
  const finalStatus = status === "PUBLISHED" && !canPublish ? "DRAFT" : status;

  const nextVersionNumber = (plan.versions[0]?.versionNumber ?? 0) + 1;
  const featureByKey = features.length > 0 ? await prisma.pricingFeature.findMany({ where: { key: { in: features.map((f) => f.featureKey) } } }) : [];
  const featureIdByKey = new Map(featureByKey.map((f) => [f.key, f.id]));

  const now = new Date();
  const publishing = finalStatus === "PUBLISHED";
  const updated = await prisma.$transaction(async (tx) => {
    const version = await tx.pricingVersion.create({
      data: {
        pricingPlanId: plan.id,
        versionNumber: nextVersionNumber,
        monthlyPrice,
        annualPrice,
        currency,
        trialPeriodDays,
        includedUsers,
        additionalUserPrice,
        ctaTarget,
        effectiveDate,
        expirationDate,
        translations: translations as unknown as Prisma.InputJsonValue,
        createdByUserId: auth.context.adminUser.id,
        publishedAt: publishing ? now : null,
        publishedByUserId: publishing ? auth.context.adminUser.id : null,
        features: {
          create: features.map((f) => ({ pricingFeatureId: featureIdByKey.get(f.featureKey)!, value: f.value })),
        },
      },
    });
    return tx.pricingPlan.update({
      where: { id: plan.id },
      data: {
        currentVersionId: version.id,
        status: finalStatus,
        submittedByUserId: null,
        reviewComment: null,
        ...(recommended !== undefined ? { recommended } : {}),
      },
      include: { currentVersion: { include: { features: { include: { feature: true } } } } },
    });
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "pricing.save",
    resourceType: "PricingPlan",
    resourceId: plan.id,
    before: { status: plan.status },
    after: { status: finalStatus, versionNumber: nextVersionNumber, monthlyPrice, annualPrice, currency },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", plan: updated });
}

/**
 * Delete — always available (no status/everPublished gate the way the
 * old governed workflow enforced), matching Careers' "Delete Job" model.
 * Unlike JobListing, nothing else has an FK depending on a PricingPlan's
 * identity (PricingVersion/PricingPromotion rows cascade with it, and
 * that's exactly right — they only exist to belong to this plan), so a
 * real hard delete is always safe here; there's no candidate-data-style
 * table that would need a soft-delete fallback.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "pricing", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const plan = await prisma.pricingPlan.findUnique({ where: { id } });
  if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

  await prisma.pricingPlan.delete({ where: { id } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "pricing.delete",
    resourceType: "PricingPlan",
    resourceId: id,
    before: { slug: plan.slug, status: plan.status },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
