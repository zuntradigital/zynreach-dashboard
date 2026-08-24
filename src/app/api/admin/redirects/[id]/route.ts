import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { updateRedirectSchema } from "@/lib/validation";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "settings", "manage");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const redirect = await prisma.redirect.findUnique({ where: { id } });
  if (!redirect) return NextResponse.json({ error: "Redirect not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = updateRedirectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid redirect values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { to, permanent } = parsed.data;

  const updated = await prisma.redirect.update({ where: { id }, data: { to, permanent } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "redirect.update",
    resourceType: "Redirect",
    resourceId: id,
    before: { to: redirect.to, permanent: redirect.permanent },
    after: { to, permanent },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", redirect: updated });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "settings", "manage");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const redirect = await prisma.redirect.findUnique({ where: { id } });
  if (!redirect) return NextResponse.json({ error: "Redirect not found." }, { status: 404 });

  await prisma.redirect.delete({ where: { id } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "redirect.delete",
    resourceType: "Redirect",
    resourceId: id,
    before: { from: redirect.from, to: redirect.to, permanent: redirect.permanent },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
