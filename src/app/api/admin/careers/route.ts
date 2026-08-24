import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { createJobListingSchema, jobListingsQuerySchema } from "@/lib/validation";
import { executeDueJobListingPublications } from "@/lib/content/scheduler";

const EMPTY_LOCALE_TEXT = { title: "", team: "", location: "", employmentType: "", description: "", responsibilities: [], qualifications: [], preferredSkills: [] };

/** SCR-015 Careers Listing Override. careers:view permission. */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "careers", "view");
  if (!auth.ok) return auth.response;

  await executeDueJobListingPublications();

  const { searchParams } = new URL(request.url);
  const parsed = jobListingsQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }
  const { status, page, take } = parsed.data;

  const where: Prisma.JobListingWhereInput = status ? { status } : {};

  const [listings, total] = await Promise.all([
    prisma.jobListing.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * take,
      take,
      include: { currentVersion: { select: { translations: true, datePosted: true } } },
    }),
    prisma.jobListing.count({ where }),
  ]);

  return NextResponse.json({ listings, total, page, take });
}

/**
 * SCR-015 "New Listing." Creates the JobListing plus its first, empty
 * JobListingVersion (versionNumber 1) in one transaction — same "never
 * exists without at least one version" invariant as every other governed
 * content type.
 */
export async function POST(request: Request) {
  const auth = await requirePermission(request, "careers", "create");
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = createJobListingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid listing values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { slug } = parsed.data;

  const existing = await prisma.jobListing.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });
  }

  const listing = await prisma.$transaction(async (tx) => {
    const created = await tx.jobListing.create({
      data: { slug, status: "DRAFT", createdByUserId: auth.context.adminUser.id },
    });
    const version = await tx.jobListingVersion.create({
      data: {
        jobListingId: created.id,
        versionNumber: 1,
        translations: { en: EMPTY_LOCALE_TEXT, ar: EMPTY_LOCALE_TEXT } as unknown as Prisma.InputJsonValue,
        createdByUserId: auth.context.adminUser.id,
      },
    });
    return tx.jobListing.update({
      where: { id: created.id },
      data: { currentVersionId: version.id },
      include: { currentVersion: true },
    });
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "careers.create",
    resourceType: "JobListing",
    resourceId: listing.id,
    after: { slug },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", listing }, { status: 201 });
}
