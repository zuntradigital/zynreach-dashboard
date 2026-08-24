import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { saveDocCategorySchema } from "@/lib/validation";

/** Knowledge Center §12.3/§19 DocCategory — flat taxonomy, plain CRUD (mirrors blog/categories, scoped to the `docs` permission module). */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "docs", "view");
  if (!auth.ok) return auth.response;

  const categories = await prisma.docCategory.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  return NextResponse.json({ categories });
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, "docs", "create");
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);

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

  const existing = await prisma.docCategory.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });

  const category = await prisma.docCategory.create({
    data: { slug: parsed.data.slug, order: parsed.data.order, translations: parsed.data.translations as unknown as Prisma.InputJsonValue },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "docs.category.create",
    resourceType: "DocCategory",
    resourceId: category.id,
    after: { slug: category.slug },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", category }, { status: 201 });
}
