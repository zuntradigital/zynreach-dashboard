import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { findMediaAssetUsage } from "@/lib/media/usage";

/** FR-ADM-011 / SCR-026's usage list. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "media", "view");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const asset = await prisma.mediaAsset.findUnique({ where: { id }, select: { id: true } });
  if (!asset) return NextResponse.json({ error: "Asset not found." }, { status: 404 });

  const usage = await findMediaAssetUsage(id);
  return NextResponse.json({ usage });
}
