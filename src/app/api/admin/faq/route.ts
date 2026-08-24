import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { createFaqItemSchema, faqItemsQuerySchema } from "@/lib/validation";

/** Knowledge Center FAQ list — faq:view permission. */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "faq", "view");
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const parsed = faqItemsQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }
  const { category, status, page, take } = parsed.data;

  const where: Prisma.FaqItemWhereInput = { ...(category ? { category } : {}), ...(status ? { status } : {}) };

  const [items, total] = await Promise.all([
    prisma.faqItem.findMany({
      where,
      orderBy: [{ category: "asc" }, { order: "asc" }, { createdAt: "asc" }],
      skip: (page - 1) * take,
      take,
    }),
    prisma.faqItem.count({ where }),
  ]);

  return NextResponse.json({ items, total, page, take });
}

/** "New FAQ" — direct-save, no version snapshot (matching DocArticle). Starts DRAFT. */
export async function POST(request: Request) {
  const auth = await requirePermission(request, "faq", "create");
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = createFaqItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid FAQ values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { category, order, translations } = parsed.data;

  const item = await prisma.faqItem.create({
    data: {
      category,
      order,
      status: "DRAFT",
      translations: translations as unknown as Prisma.InputJsonValue,
      createdByUserId: auth.context.adminUser.id,
    },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "faq.create",
    resourceType: "FaqItem",
    resourceId: item.id,
    after: { category },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", item }, { status: 201 });
}
