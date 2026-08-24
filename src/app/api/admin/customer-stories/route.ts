import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { createCustomerStorySchema, customerStoriesQuerySchema } from "@/lib/validation";
import { executeDueCustomerStoryPublications } from "@/lib/content/scheduler";

const EMPTY_LOCALE_TEXT = { challenge: "", solution: "", results: "", metrics: [], testimonialQuote: "" };

/** Knowledge Center §7.4 Customer Story List. customerStories:view permission. */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "customerStories", "view");
  if (!auth.ok) return auth.response;

  await executeDueCustomerStoryPublications();

  const { searchParams } = new URL(request.url);
  const parsed = customerStoriesQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }
  const { status, industry, page, take } = parsed.data;

  const where: Prisma.CustomerStoryWhereInput = { ...(status ? { status } : {}), ...(industry ? { industry } : {}) };

  const [stories, total] = await Promise.all([
    prisma.customerStory.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * take,
      take,
      include: {
        customerLogo: { select: { url: true, altText: true } },
        currentVersion: { select: { translations: true, publishedAt: true } },
      },
    }),
    prisma.customerStory.count({ where }),
  ]);

  return NextResponse.json({ stories, total, page, take });
}

/**
 * "New Customer Story." Creates the CustomerStory plus its first, empty
 * CustomerStoryVersion (versionNumber 1) in one transaction — same "never
 * exists without at least one version" invariant as Blog/Resources/Webinars.
 */
export async function POST(request: Request) {
  const auth = await requirePermission(request, "customerStories", "create");
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = createCustomerStorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid customer story values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { slug, customerName, industry, companySize, country, featured } = parsed.data;

  const existing = await prisma.customerStory.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });
  }

  const story = await prisma.$transaction(async (tx) => {
    const created = await tx.customerStory.create({
      data: { slug, customerName, industry, companySize, country, featured, status: "DRAFT", createdByUserId: auth.context.adminUser.id },
    });
    const version = await tx.customerStoryVersion.create({
      data: {
        customerStoryId: created.id,
        versionNumber: 1,
        relatedCapabilitySlugs: [],
        translations: { en: EMPTY_LOCALE_TEXT, ar: EMPTY_LOCALE_TEXT } as unknown as Prisma.InputJsonValue,
        createdByUserId: auth.context.adminUser.id,
      },
    });
    return tx.customerStory.update({
      where: { id: created.id },
      data: { currentVersionId: version.id },
      include: { currentVersion: true },
    });
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "customerStories.create",
    resourceType: "CustomerStory",
    resourceId: story.id,
    after: { slug, customerName, industry, companySize, country, featured },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", story }, { status: 201 });
}
