import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { createDocArticleSchema, docArticlesQuerySchema } from "@/lib/validation";

const EMPTY_LOCALE_TEXT = { title: "", content: [] as unknown[] };

/** Knowledge Center §12.3/§19 Documentation article list. docs:view permission. */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "docs", "view");
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const parsed = docArticlesQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }
  const { categoryId, status, page, take } = parsed.data;

  const where: Prisma.DocArticleWhereInput = { ...(categoryId ? { categoryId } : {}), ...(status ? { status } : {}) };

  const [articles, total] = await Promise.all([
    prisma.docArticle.findMany({
      where,
      orderBy: [{ order: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * take,
      take,
      include: { category: { select: { slug: true, translations: true } } },
    }),
    prisma.docArticle.count({ where }),
  ]);

  return NextResponse.json({ articles, total, page, take });
}

/**
 * "New Article" — creates the DocArticle directly, no version snapshot
 * (unlike Blog/Resources' first-empty-version transaction): DocArticle
 * has no version sub-model at all, everything lives on the one row.
 */
export async function POST(request: Request) {
  const auth = await requirePermission(request, "docs", "create");
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = createDocArticleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid article values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { slug, title, categoryId, parentArticleId } = parsed.data;

  const existing = await prisma.docArticle.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });
  }

  if (categoryId) {
    const categoryExists = await prisma.docCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!categoryExists) return NextResponse.json({ error: "Category does not exist." }, { status: 400 });
  }
  if (parentArticleId) {
    const parentExists = await prisma.docArticle.findUnique({ where: { id: parentArticleId }, select: { id: true } });
    if (!parentExists) return NextResponse.json({ error: "Parent article does not exist." }, { status: 400 });
  }

  const article = await prisma.docArticle.create({
    data: {
      slug,
      categoryId,
      parentArticleId,
      status: "DRAFT",
      relatedArticleSlugs: [],
      translations: { en: { ...EMPTY_LOCALE_TEXT, title }, ar: EMPTY_LOCALE_TEXT } as unknown as Prisma.InputJsonValue,
      createdByUserId: auth.context.adminUser.id,
    },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "docs.article.create",
    resourceType: "DocArticle",
    resourceId: article.id,
    after: { slug, categoryId, parentArticleId },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", article }, { status: 201 });
}
