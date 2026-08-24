import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { createBannerSchema } from "@/lib/validation";

/**
 * SRS §22 "Global Banners / Announcement Bars" (SCR-044). Same
 * settings:manage permission as the rest of §22's Global Website
 * Settings module — see AnnouncementBanner's schema comment for why
 * this is a dedicated table/route pair instead of a SiteSetting group.
 */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "settings", "manage");
  if (!auth.ok) return auth.response;

  const banners = await prisma.announcementBanner.findMany({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ banners });
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

  const parsed = createBannerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid banner values." }, { status: 400 });
  }
  const { message, link, startDate, endDate, dismissible, targetZone } = parsed.data;

  const banner = await prisma.announcementBanner.create({
    data: {
      message,
      link: link || null,
      startDate: startDate ?? null,
      endDate: endDate ?? null,
      dismissible,
      targetZone,
      createdByUserId: auth.context.adminUser.id,
    },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "banner.create",
    resourceType: "AnnouncementBanner",
    resourceId: banner.id,
    after: {
      message,
      link: link ?? null,
      startDate: startDate ? startDate.toISOString() : null,
      endDate: endDate ? endDate.toISOString() : null,
      dismissible,
      targetZone,
    },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", banner }, { status: 201 });
}
