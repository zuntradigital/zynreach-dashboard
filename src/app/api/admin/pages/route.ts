import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { createPageSchema, pagesQuerySchema } from "@/lib/validation";
import { executeDueScheduledPublications } from "@/lib/content/scheduler";

/**
 * SCR-002 Content List — Pages. content:view permission (held by every
 * content role — see prisma/seed.ts's grantContent calls).
 */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "content", "view");
  if (!auth.ok) return auth.response;

  await executeDueScheduledPublications();

  const { searchParams } = new URL(request.url);
  const parsed = pagesQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }
  const { status, classification, page, take } = parsed.data;

  const where: Prisma.PageWhereInput = {
    ...(status ? { status } : {}),
    ...(classification ? { classification } : {}),
  };

  const [pages, total] = await Promise.all([
    prisma.page.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * take,
      take,
      select: {
        id: true,
        slug: true,
        title: true,
        templateType: true,
        classification: true,
        status: true,
        updatedAt: true,
        submittedByUserId: true,
      },
    }),
    prisma.page.count({ where }),
  ]);

  return NextResponse.json({ pages, total, page, take });
}

/**
 * SCR-003 "New Page." Creates the Page plus its first PageVersion
 * (versionNumber 1) in one transaction — a Page never exists without at
 * least one version, matching "Page ... ordered PageVersion/PageSection
 * history" (§28.1).
 */
export async function POST(request: Request) {
  const auth = await requirePermission(request, "content", "create");
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = createPageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid page values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { slug, title, templateType, classification, componentBlocks } = parsed.data;

  const existing = await prisma.page.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });
  }

  const page = await prisma.$transaction(async (tx) => {
    const created = await tx.page.create({
      data: {
        slug,
        title,
        templateType,
        classification,
        status: "DRAFT",
        createdByUserId: auth.context.adminUser.id,
      },
    });
    const version = await tx.pageVersion.create({
      data: {
        pageId: created.id,
        versionNumber: 1,
        title,
        componentBlocks: componentBlocks as unknown as Prisma.InputJsonValue,
        createdByUserId: auth.context.adminUser.id,
      },
    });
    return tx.page.update({
      where: { id: created.id },
      data: { currentVersionId: version.id },
      include: { currentVersion: true },
    });
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "page.create",
    resourceType: "Page",
    resourceId: page.id,
    after: { slug, title, templateType, classification },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", page }, { status: 201 });
}
