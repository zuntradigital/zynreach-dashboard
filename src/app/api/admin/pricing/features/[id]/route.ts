import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { savePricingFeatureSchema } from "@/lib/validation";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "pricing", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const existing = await prisma.pricingFeature.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Feature not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = savePricingFeatureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid feature values.", issues: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.key !== existing.key) {
    const clash = await prisma.pricingFeature.findUnique({ where: { key: parsed.data.key } });
    if (clash) return NextResponse.json({ error: "That key is already in use." }, { status: 409 });
  }

  const updated = await prisma.pricingFeature.update({
    where: { id },
    data: { ...parsed.data, translations: parsed.data.translations as unknown as Prisma.InputJsonValue },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "pricing.feature.update",
    resourceType: "PricingFeature",
    resourceId: id,
    before: { key: existing.key },
    after: { key: updated.key },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", feature: updated });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "pricing", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const existing = await prisma.pricingFeature.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Feature not found." }, { status: 404 });

  await prisma.pricingFeature.delete({ where: { id } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "pricing.feature.delete",
    resourceType: "PricingFeature",
    resourceId: id,
    before: { key: existing.key },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
