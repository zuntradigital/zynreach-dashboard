import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { savePromotionSchema } from "@/lib/validation";

/**
 * SRS §15.1/§28.1 Promotion — a discount referenced by one or more
 * PricingPlans, not itself workflow-governed (§28.1 gives it no
 * lifecycle); its start/end date window is its own "is this live" signal,
 * evaluated at public-read time (src/app/api/public/pricing/route.ts).
 */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "pricing", "view");
  if (!auth.ok) return auth.response;

  const promotions = await prisma.promotion.findMany({
    orderBy: { createdAt: "desc" },
    include: { planLinks: { include: { plan: { select: { id: true, slug: true } } } } },
  });
  return NextResponse.json({ promotions });
}

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
  const parsed = savePromotionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid promotion values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { planIds, translations, discountType, discountValue, startDate, endDate } = parsed.data;

  if (endDate && startDate && endDate <= startDate) {
    return NextResponse.json({ error: "End Date must be after Start Date." }, { status: 400 });
  }
  if (planIds.length > 0) {
    const found = await prisma.pricingPlan.count({ where: { id: { in: planIds } } });
    if (found !== new Set(planIds).size) {
      return NextResponse.json({ error: "One or more plan IDs do not exist." }, { status: 400 });
    }
  }

  const promotion = await prisma.promotion.create({
    data: {
      translations: translations as unknown as Prisma.InputJsonValue,
      discountType,
      discountValue,
      startDate,
      endDate,
      planLinks: { create: planIds.map((pricingPlanId) => ({ pricingPlanId })) },
    },
    include: { planLinks: { include: { plan: { select: { id: true, slug: true } } } } },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "pricing.promotion.create",
    resourceType: "Promotion",
    resourceId: promotion.id,
    after: { discountType, discountValue, planIds },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", promotion }, { status: 201 });
}
