import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { saveAuthorSchema } from "@/lib/validation";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "blog", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const existing = await prisma.author.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Author not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = saveAuthorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid author values.", issues: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.author.update({
    where: { id },
    data: { translations: parsed.data.translations as unknown as Prisma.InputJsonValue },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "blog.author.update",
    resourceType: "Author",
    resourceId: id,
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", author: updated });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "blog", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const existing = await prisma.author.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Author not found." }, { status: 404 });

  const inUse = await prisma.blogPost.count({ where: { authorId: id } });
  if (inUse > 0) return NextResponse.json({ error: "This author is used by one or more posts and cannot be deleted." }, { status: 409 });

  await prisma.author.delete({ where: { id } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "blog.author.delete",
    resourceType: "Author",
    resourceId: id,
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
