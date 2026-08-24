import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";

/**
 * SRS §22 Global Banners (SCR-044) — banners are individually
 * created/deleted records (unlike SiteSetting's upsert-only groups), so
 * this is a real delete, not a soft-deactivate; there's no audit-history
 * dependency on a banner row the way there is for AdminUser (§23).
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "settings", "manage");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const banner = await prisma.announcementBanner.findUnique({ where: { id } });
  if (!banner) {
    return NextResponse.json({ error: "Banner not found." }, { status: 404 });
  }

  await prisma.announcementBanner.delete({ where: { id } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "banner.delete",
    resourceType: "AnnouncementBanner",
    resourceId: id,
    before: {
      message: banner.message,
      link: banner.link,
      startDate: banner.startDate ? banner.startDate.toISOString() : null,
      endDate: banner.endDate ? banner.endDate.toISOString() : null,
      dismissible: banner.dismissible,
      targetZone: banner.targetZone,
    },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
