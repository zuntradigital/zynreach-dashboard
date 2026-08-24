import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { jobApplicationsQuerySchema } from "@/lib/validation";

/**
 * Careers → Applications list (SCR-015's sibling screen). Reuses the
 * existing `careers:view` permission rather than a new one — anyone who
 * can see job listings can see who applied to them. Filterable by
 * `jobListingId` so the Jobs → Applications grouping the Dashboard UI
 * presents can be driven by simple query params against the real
 * JobApplication.jobListingId relation (not a string match).
 */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "careers", "view");
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const parsed = jobApplicationsQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { jobListingId, page, take } = parsed.data;

  const where = jobListingId ? { jobListingId } : {};

  const [applications, total] = await Promise.all([
    prisma.jobApplication.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      skip: (page - 1) * take,
      take,
      include: { jobListing: { select: { id: true, slug: true, status: true } } },
    }),
    prisma.jobApplication.count({ where }),
  ]);

  return NextResponse.json({ applications, total, page, take });
}
