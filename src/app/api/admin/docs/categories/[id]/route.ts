import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { saveDocCategorySchema } from "@/lib/validation";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "docs", "view");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const category = await prisma.docCategory.findUnique({ where: { id } });
  if (!category) return NextResponse.json({ error: "Category not found." }, { status: 404 });

  return NextResponse.json({ category });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "docs", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const existing = await prisma.docCategory.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Category not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = saveDocCategorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid category values.", issues: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.slug !== existing.slug) {
    const clash = await prisma.docCategory.findUnique({ where: { slug: parsed.data.slug } });
    if (clash) return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });
  }

  const updated = await prisma.docCategory.update({
    where: { id },
    data: { slug: parsed.data.slug, order: parsed.data.order, translations: parsed.data.translations as unknown as Prisma.InputJsonValue },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "docs.category.update",
    resourceType: "DocCategory",
    resourceId: id,
    before: { slug: existing.slug },
    after: { slug: updated.slug },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", category: updated });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "docs", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const existing = await prisma.docCategory.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Category not found." }, { status: 404 });

  const inUse = await prisma.docArticle.count({ where: { categoryId: id } });
  if (inUse > 0) return NextResponse.json({ error: "This category is used by one or more articles and cannot be deleted." }, { status: 409 });

  await prisma.docCategory.delete({ where: { id } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "docs.category.delete",
    resourceType: "DocCategory",
    resourceId: id,
    before: { slug: existing.slug },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
