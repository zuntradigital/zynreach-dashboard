import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { createPricingPlanSchema, pricingPlansQuerySchema } from "@/lib/validation";
import { executeDuePricingPublications } from "@/lib/content/scheduler";

const EMPTY_LOCALE_TEXT = { name: "", description: "", priceSuffix: "", featureList: [], ctaLabel: "" };

/** SCR-020 Pricing Plan List. pricing:view permission. */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "pricing", "view");
  if (!auth.ok) return auth.response;

  await executeDuePricingPublications();

  const { searchParams } = new URL(request.url);
  const parsed = pricingPlansQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }
  const { status, page, take } = parsed.data;

  const where: Prisma.PricingPlanWhereInput = status ? { status } : {};

  const [plans, total] = await Promise.all([
    prisma.pricingPlan.findMany({
      where,
      orderBy: [{ order: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * take,
      take,
      include: { currentVersion: { select: { translations: true, monthlyPrice: true, annualPrice: true, currency: true } } },
    }),
    prisma.pricingPlan.count({ where }),
  ]);

  return NextResponse.json({ plans, total, page, take });
}

/**
 * SCR-020 "New Plan." Creates the PricingPlan plus its first, empty
 * PricingVersion (versionNumber 1) in one transaction — same "never
 * exists without at least one version" invariant as Page/PageVersion.
 * The first version starts blank (matching createPageSchema's own
 * componentBlocks: default([])); real values are filled in via the
 * PATCH "save draft" endpoint.
 */
export async function POST(request: Request) {
  const auth = await requirePermission(request, "pricing", "edit");
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = createPricingPlanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid plan values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { slug, visibility, featured, recommended, order } = parsed.data;

  const existing = await prisma.pricingPlan.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });
  }

  const plan = await prisma.$transaction(async (tx) => {
    const created = await tx.pricingPlan.create({
      data: { slug, visibility, featured, recommended, order, status: "DRAFT", createdByUserId: auth.context.adminUser.id },
    });
    const version = await tx.pricingVersion.create({
      data: {
        pricingPlanId: created.id,
        versionNumber: 1,
        currency: "USD",
        translations: { en: EMPTY_LOCALE_TEXT, ar: EMPTY_LOCALE_TEXT } as unknown as Prisma.InputJsonValue,
        createdByUserId: auth.context.adminUser.id,
      },
    });
    return tx.pricingPlan.update({
      where: { id: created.id },
      data: { currentVersionId: version.id },
      include: { currentVersion: true },
    });
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "pricing.create",
    resourceType: "PricingPlan",
    resourceId: plan.id,
    after: { slug, visibility, featured, recommended, order },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", plan }, { status: 201 });
}
