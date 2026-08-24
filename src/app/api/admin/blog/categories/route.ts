import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { saveCategorySchema } from "@/lib/validation";

/** SRS §16/§28.1 Category — shared taxonomy, plain CRUD (see Author's own comment). */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "blog", "view");
  if (!auth.ok) return auth.response;

  const categories = await prisma.category.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json({ categories });
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, "blog", "edit");
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = saveCategorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid category values.", issues: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.category.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });

  const category = await prisma.category.create({
    data: { slug: parsed.data.slug, translations: parsed.data.translations as unknown as Prisma.InputJsonValue },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "blog.category.create",
    resourceType: "Category",
    resourceId: category.id,
    after: { slug: category.slug },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", category }, { status: 201 });
}
