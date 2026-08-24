import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { createResourceSchema, resourcesQuerySchema } from "@/lib/validation";
import { executeDueResourcePublications } from "@/lib/content/scheduler";

const EMPTY_LOCALE_TEXT = { title: "", description: "" };

/** SCR-007 Resources List. resources:view permission. */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "resources", "view");
  if (!auth.ok) return auth.response;

  await executeDueResourcePublications();

  const { searchParams } = new URL(request.url);
  const parsed = resourcesQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }
  const { status, resourceFormat, page, take } = parsed.data;

  const where: Prisma.ResourceWhereInput = { ...(status ? { status } : {}), ...(resourceFormat ? { resourceFormat } : {}) };

  const [resources, total] = await Promise.all([
    prisma.resource.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * take,
      take,
      include: { currentVersion: { select: { translations: true } } },
    }),
    prisma.resource.count({ where }),
  ]);

  return NextResponse.json({ resources, total, page, take });
}

/**
 * SCR-008 "New Resource." Creates the Resource plus its first, empty
 * ResourceVersion (versionNumber 1) in one transaction — same "never
 * exists without at least one version" invariant as Page/PricingPlan/BlogPost.
 */
export async function POST(request: Request) {
  const auth = await requirePermission(request, "resources", "create");
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = createResourceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid resource values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { slug, resourceFormat, gated } = parsed.data;

  const existing = await prisma.resource.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });
  }

  const resource = await prisma.$transaction(async (tx) => {
    const created = await tx.resource.create({
      data: { slug, resourceFormat, gated, status: "DRAFT", createdByUserId: auth.context.adminUser.id },
    });
    const version = await tx.resourceVersion.create({
      data: {
        resourceId: created.id,
        versionNumber: 1,
        translations: { en: EMPTY_LOCALE_TEXT, ar: EMPTY_LOCALE_TEXT } as unknown as Prisma.InputJsonValue,
        createdByUserId: auth.context.adminUser.id,
      },
    });
    return tx.resource.update({
      where: { id: created.id },
      data: { currentVersionId: version.id },
      include: { currentVersion: true },
    });
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "resources.create",
    resourceType: "Resource",
    resourceId: resource.id,
    after: { slug, resourceFormat, gated },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", resource }, { status: 201 });
}
