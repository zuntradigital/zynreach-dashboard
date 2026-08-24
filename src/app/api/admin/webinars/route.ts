import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { createWebinarSchema, webinarsQuerySchema } from "@/lib/validation";
import { executeDueWebinarPublications } from "@/lib/content/scheduler";

const EMPTY_LOCALE_TEXT = { title: "", description: "", speakerName: "", speakerTitle: "", speakerCompany: "" };

/** Knowledge Center §9 Webinar List. webinars:view permission. */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "webinars", "view");
  if (!auth.ok) return auth.response;

  await executeDueWebinarPublications();

  const { searchParams } = new URL(request.url);
  const parsed = webinarsQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }
  const { status, page, take } = parsed.data;

  const where: Prisma.WebinarWhereInput = status ? { status } : {};

  const [webinars, total] = await Promise.all([
    prisma.webinar.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * take,
      take,
      include: {
        currentVersion: { select: { translations: true, scheduledAt: true, isOnDemand: true } },
      },
    }),
    prisma.webinar.count({ where }),
  ]);

  return NextResponse.json({ webinars, total, page, take });
}

/**
 * "New Webinar." Creates the Webinar plus its first, empty WebinarVersion
 * (versionNumber 1) in one transaction — same "never exists without at
 * least one version" invariant as Page/PricingPlan/BlogPost/Resource.
 */
export async function POST(request: Request) {
  const auth = await requirePermission(request, "webinars", "create");
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = createWebinarSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid webinar values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { slug, title, gated, featured } = parsed.data;

  const existing = await prisma.webinar.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });
  }

  const webinar = await prisma.$transaction(async (tx) => {
    const created = await tx.webinar.create({
      data: { slug, gated, featured, status: "DRAFT", createdByUserId: auth.context.adminUser.id },
    });
    const version = await tx.webinarVersion.create({
      data: {
        webinarId: created.id,
        versionNumber: 1,
        translations: {
          en: { ...EMPTY_LOCALE_TEXT, title },
          ar: EMPTY_LOCALE_TEXT,
        } as unknown as Prisma.InputJsonValue,
        createdByUserId: auth.context.adminUser.id,
      },
    });
    return tx.webinar.update({
      where: { id: created.id },
      data: { currentVersionId: version.id },
      include: { currentVersion: true },
    });
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "webinars.create",
    resourceType: "Webinar",
    resourceId: webinar.id,
    after: { slug, gated, featured },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", webinar }, { status: 201 });
}
