import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";

/** Careers → Applications detail — full submitted application data, plus the resolved job (if the JobListing still exists). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "careers", "view");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const application = await prisma.jobApplication.findUnique({
    where: { id },
    include: { jobListing: { select: { id: true, slug: true, status: true, currentVersion: { select: { translations: true } } } } },
  });
  if (!application) return NextResponse.json({ error: "Application not found." }, { status: 404 });

  return NextResponse.json({ application });
}
