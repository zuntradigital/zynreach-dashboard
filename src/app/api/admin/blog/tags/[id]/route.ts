import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { saveTagSchema } from "@/lib/validation";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "blog", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const existing = await prisma.tag.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Tag not found." }, { status: 404 });

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

  if (parsed.data.slug !== existing.slug) {
    const clash = await prisma.tag.findUnique({ where: { slug: parsed.data.slug } });
    if (clash) return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });
  }

  const updated = await prisma.tag.update({
    where: { id },
    data: { slug: parsed.data.slug, translations: parsed.data.translations as unknown as Prisma.InputJsonValue },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "blog.tag.update",
    resourceType: "Tag",
    resourceId: id,
    before: { slug: existing.slug },
    after: { slug: updated.slug },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", tag: updated });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "blog", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const existing = await prisma.tag.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Tag not found." }, { status: 404 });

  const inUse = await prisma.blogPostVersionTag.count({ where: { tagId: id } });
  if (inUse > 0) return NextResponse.json({ error: "This tag is used by one or more post versions and cannot be deleted." }, { status: 409 });

  await prisma.tag.delete({ where: { id } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "blog.tag.delete",
    resourceType: "Tag",
    resourceId: id,
    before: { slug: existing.slug },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
