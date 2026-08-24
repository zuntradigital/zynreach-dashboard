import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { savePricingFeatureSchema } from "@/lib/validation";

/**
 * SRS §28.1 PricingFeature — the shared feature/limit taxonomy behind the
 * public Pricing page's comparison table. Not itself workflow-governed
 * (§28.1 gives it no lifecycle of its own, unlike PricingPlan) — plain
 * CRUD gated by the same pricing:view/edit permissions, matching how
 * Category/Tag taxonomy is scoped to its owning module rather than
 * getting its own permission namespace.
 */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "pricing", "view");
  if (!auth.ok) return auth.response;

  const features = await prisma.pricingFeature.findMany({ orderBy: { order: "asc" } });
  return NextResponse.json({ features });
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
  const parsed = savePricingFeatureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid feature values.", issues: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.pricingFeature.findUnique({ where: { key: parsed.data.key } });
  if (existing) {
    return NextResponse.json({ error: "That key is already in use." }, { status: 409 });
  }

  const feature = await prisma.pricingFeature.create({
    data: { ...parsed.data, translations: parsed.data.translations as unknown as Prisma.InputJsonValue },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "pricing.feature.create",
    resourceType: "PricingFeature",
    resourceId: feature.id,
    after: { key: feature.key },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", feature }, { status: 201 });
}
