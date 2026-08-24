import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { createRedirectSchema } from "@/lib/validation";

/** CMS General "Redirects" — same settings:manage gate as Site Settings/Banners. */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "settings", "manage");
  if (!auth.ok) return auth.response;

  const redirects = await prisma.redirect.findMany({ orderBy: { createdAt: "desc" } });

  return NextResponse.json({ redirects });
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, "settings", "manage");
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = createRedirectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid redirect values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { from, to, permanent } = parsed.data;

  const existing = await prisma.redirect.findUnique({ where: { from } });
  if (existing) {
    return NextResponse.json({ error: "A redirect from that path already exists." }, { status: 409 });
  }

  const redirect = await prisma.redirect.create({
    data: { from, to, permanent, createdByUserId: auth.context.adminUser.id },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "redirect.create",
    resourceType: "Redirect",
    resourceId: redirect.id,
    after: { from, to, permanent },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", redirect }, { status: 201 });
}
