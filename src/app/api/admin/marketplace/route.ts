import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";

/** ZynReach Marketplace admin list — every MarketplaceListing row, seeded
 * one per real tool slug (prisma/seed.ts). No create/delete: the catalog
 * of tools is defined by the website's own capabilities content, not
 * admin-authored, so this module only ever toggles visibility/featured/
 * plan-tier/order on rows that already exist. */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "marketplace", "view");
  if (!auth.ok) return auth.response;

  const listings = await prisma.marketplaceListing.findMany({ orderBy: [{ order: "asc" }, { toolSlug: "asc" }] });
  return NextResponse.json({ listings });
}
