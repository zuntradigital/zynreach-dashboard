import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { saveTagSchema } from "@/lib/validation";

/** SRS §16/§28.1 Tag — shared taxonomy, plain CRUD (see Author's own comment). */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "blog", "view");
  if (!auth.ok) return auth.response;

  const tags = await prisma.tag.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json({ tags });
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
  const parsed = saveTagSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid tag values.", issues: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.tag.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });

  const tag = await prisma.tag.create({
    data: { slug: parsed.data.slug, translations: parsed.data.translations as unknown as Prisma.InputJsonValue },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "blog.tag.create",
    resourceType: "Tag",
    resourceId: tag.id,
    after: { slug: tag.slug },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", tag }, { status: 201 });
}
