import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { saveApiResourceGroupSchema } from "@/lib/validation";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "api", "view");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const group = await prisma.apiResourceGroup.findUnique({ where: { id } });
  if (!group) return NextResponse.json({ error: "Resource group not found." }, { status: 404 });

  return NextResponse.json({ group });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "api", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const existing = await prisma.apiResourceGroup.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Resource group not found." }, { status: 404 });

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

  if (parsed.data.slug !== existing.slug) {
    const clash = await prisma.apiResourceGroup.findUnique({ where: { slug: parsed.data.slug } });
    if (clash) return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });
  }

  const updated = await prisma.apiResourceGroup.update({
    where: { id },
    data: { slug: parsed.data.slug, order: parsed.data.order, translations: parsed.data.translations as unknown as Prisma.InputJsonValue },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "api.group.update",
    resourceType: "ApiResourceGroup",
    resourceId: id,
    before: { slug: existing.slug },
    after: { slug: updated.slug },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", group: updated });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "api", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const existing = await prisma.apiResourceGroup.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Resource group not found." }, { status: 404 });

  const inUse = await prisma.apiEndpoint.count({ where: { resourceGroupId: id } });
  if (inUse > 0) return NextResponse.json({ error: "This resource group is used by one or more endpoints and cannot be deleted." }, { status: 409 });

  await prisma.apiResourceGroup.delete({ where: { id } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "api.group.delete",
    resourceType: "ApiResourceGroup",
    resourceId: id,
    before: { slug: existing.slug },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
