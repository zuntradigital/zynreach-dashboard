import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { savePromotionSchema } from "@/lib/validation";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "pricing", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const existing = await prisma.promotion.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Promotion not found." }, { status: 404 });

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

  const updated = await prisma.$transaction(async (tx) => {
    await tx.promotionPlan.deleteMany({ where: { promotionId: id } });
    return tx.promotion.update({
      where: { id },
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
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "pricing.promotion.update",
    resourceType: "Promotion",
    resourceId: id,
    after: { discountType, discountValue, planIds },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", promotion: updated });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "pricing", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const existing = await prisma.promotion.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Promotion not found." }, { status: 404 });

  await prisma.promotion.delete({ where: { id } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "pricing.promotion.delete",
    resourceType: "Promotion",
    resourceId: id,
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
