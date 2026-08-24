import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { updateMarketplaceListingSchema } from "@/lib/validation";

export async function PATCH(request: Request, context: { params: Promise<{ toolSlug: string }> }) {
  const auth = await requirePermission(request, "marketplace", "manage");
  if (!auth.ok) return auth.response;

  const { toolSlug } = await context.params;
  const ipAddress = getClientIp(request);

  const listing = await prisma.marketplaceListing.findUnique({ where: { toolSlug } });
  if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = updateMarketplaceListingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid listing values.", issues: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.marketplaceListing.update({ where: { toolSlug }, data: parsed.data });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "marketplace.update",
    resourceType: "MarketplaceListing",
    resourceId: updated.id,
    before: { visible: listing.visible, featured: listing.featured, minPlanTier: listing.minPlanTier, order: listing.order },
    after: parsed.data,
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", listing: updated });
}
