import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";
import { SETTINGS_GROUP_NAMES } from "@/lib/settings-groups";

/**
 * SRS §22 Global Website Settings, public read side. Every group in
 * SETTINGS_GROUP_NAMES holds only values that are already meant to be
 * visible on the public site one way or another (contact details,
 * social links, analytics IDs that end up in page source anyway,
 * legal-page URLs, footer/consent copy, the maintenance-mode flag the
 * site itself must react to) — none of it is a credential, so a single
 * combined read is safe to expose the same way /api/public/pricing and
 * /api/public/blog already do (service-token authenticated, not session-
 * authenticated, since the caller is System A's server, not a signed-in
 * admin — SRS §29's Public Read contract).
 *
 * Returns { settings: { [group]: { [key]: value } }, banners: [...] } —
 * banners are a separate model (AnnouncementBanner), not a SiteSetting
 * group, but belong in the same combined payload since the website needs
 * both on effectively every page render (Footer/Header/consent banner
 * all read settings; an announcement bar can appear on any page too).
 */
export async function GET(request: Request) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const [rows, banners] = await Promise.all([
    prisma.siteSetting.findMany({ where: { group: { in: SETTINGS_GROUP_NAMES } } }),
    prisma.announcementBanner.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  const settings: Record<string, Record<string, unknown>> = {};
  for (const group of SETTINGS_GROUP_NAMES) settings[group] = {};
  for (const row of rows) {
    settings[row.group] ??= {};
    settings[row.group][row.key] = row.value;
  }

  const now = new Date();
  const activeBanners = banners.filter((b) => (!b.startDate || b.startDate <= now) && (!b.endDate || b.endDate >= now));

  return NextResponse.json({
    settings,
    banners: activeBanners.map((b) => ({
      id: b.id,
      message: b.message,
      link: b.link,
      dismissible: b.dismissible,
      targetZone: b.targetZone,
    })),
  });
}
