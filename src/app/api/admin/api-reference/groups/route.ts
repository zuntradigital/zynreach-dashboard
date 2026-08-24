import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { saveApiResourceGroupSchema } from "@/lib/validation";

/** Knowledge Center §13.3 ApiResourceGroup — flat taxonomy, plain CRUD (mirrors blog/categories, scoped to the `api` permission module). */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "api", "view");
  if (!auth.ok) return auth.response;

  const groups = await prisma.apiResourceGroup.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  return NextResponse.json({ groups });
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, "api", "create");
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = saveApiResourceGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid resource group values.", issues: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.apiResourceGroup.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });

  const group = await prisma.apiResourceGroup.create({
    data: { slug: parsed.data.slug, order: parsed.data.order, translations: parsed.data.translations as unknown as Prisma.InputJsonValue },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "api.group.create",
    resourceType: "ApiResourceGroup",
    resourceId: group.id,
    after: { slug: group.slug },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", group }, { status: 201 });
}
