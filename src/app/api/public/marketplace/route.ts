import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";

/**
 * ZynReach Marketplace, public read side — same shape as
 * /api/public/redirects. The website merges these rows (keyed by
 * toolSlug) with its own static capability content (name, description,
 * icon, pillar) to get visibility/featured/plan-tier/order, which are
 * admin-configurable and don't belong hardcoded in the website repo.
 */
export async function GET(request: Request) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const listings = await prisma.marketplaceListing.findMany({
    where: { visible: true },
    select: { toolSlug: true, featured: true, minPlanTier: true, order: true },
    orderBy: [{ order: "asc" }, { toolSlug: "asc" }],
  });

  return NextResponse.json({ listings });
}
