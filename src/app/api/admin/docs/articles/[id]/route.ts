import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { saveDocArticleSchema } from "@/lib/validation";
import { hasMeaningfulContent, type ArticleBlock } from "@/lib/blog/article-blocks";

/** Documentation Article Editor load. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "docs", "view");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const article = await prisma.docArticle.findUnique({
    where: { id },
    include: { category: { select: { id: true, slug: true, translations: true } }, parentArticle: { select: { id: true, slug: true } } },
  });
  if (!article) return NextResponse.json({ error: "Article not found." }, { status: 404 });

  return NextResponse.json({ article });
}

/**
 * Documentation Article Save — direct-save, matching Resources (see that
 * PATCH handler's docstring). No versioning and no Submit -> Approve ->
 * Publish workflow (Knowledge Center §12.3 has none): the admin picks the
 * article's live status on every save and it takes effect immediately —
 * this simply updates the one DocArticle row in place, no new version row
 * is created anywhere.
 *
 * docs:publish gate — same silent-coercion pattern as Blog's own PATCH
 * handler (see its docstring): an actor who only holds docs:edit can
 * still create/edit/save an article, but a PUBLISHED choice from them is
 * silently coerced to DRAFT rather than rejected, so their other edits
 * aren't lost. An actor who *does* hold docs:publish still can't publish
 * unless both locales have a title and real body content — a hard 400
 * naming what's missing, not a silent coercion, since that's a mistake to
 * surface rather than a permission boundary to work around quietly.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "docs", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const article = await prisma.docArticle.findUnique({ where: { id } });
  if (!article) return NextResponse.json({ error: "Article not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = saveDocArticleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid article values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { status: requestedStatus, categoryId, parentArticleId, order, version, relatedArticleSlugs, translations } = parsed.data;

  if (categoryId) {
    const categoryExists = await prisma.docCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!categoryExists) return NextResponse.json({ error: "Category does not exist." }, { status: 400 });
  }
  if (parentArticleId) {
    if (parentArticleId === id) return NextResponse.json({ error: "An article cannot be its own parent." }, { status: 400 });
    const parentExists = await prisma.docArticle.findUnique({ where: { id: parentArticleId }, select: { id: true } });
    if (!parentExists) return NextResponse.json({ error: "Parent article does not exist." }, { status: 400 });
  }

  const canPublish = hasPermission(auth.context.effective, "docs", "publish");
  const canArchive = hasPermission(auth.context.effective, "docs", "archive");

  let status = requestedStatus;
  if (requestedStatus === "PUBLISHED") {
    if (!canPublish) {
      status = "DRAFT";
    } else {
      const missing: ("en" | "ar")[] = [];
      // Title is only required at publish time (not for every Draft
      // autosave) — same reasoning as Blog's title/excerpt gate.
      if (!translations.en.title.trim() || !hasMeaningfulContent(translations.en.content as ArticleBlock[])) missing.push("en");
      if (!translations.ar.title.trim() || !hasMeaningfulContent(translations.ar.content as ArticleBlock[])) missing.push("ar");
      if (missing.length > 0) {
        return NextResponse.json({ error: "Cannot publish — required content is missing.", missing }, { status: 400 });
      }
    }
  } else if (requestedStatus === "ARCHIVED" && !canArchive) {
    status = "DRAFT";
  }

  const updated = await prisma.docArticle.update({
    where: { id },
    data: {
      status,
      categoryId,
      parentArticleId,
      order,
      version,
      relatedArticleSlugs,
      translations: translations as unknown as Prisma.InputJsonValue,
    },
    include: { category: { select: { id: true, slug: true, translations: true } }, parentArticle: { select: { id: true, slug: true } } },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "docs.article.save",
    resourceType: "DocArticle",
    resourceId: article.id,
    before: { status: article.status },
    after: { status },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", article: updated });
}

/**
 * Delete — always available (no status/versioning gate, matching
 * Blog/Resources' "Delete" model). Child articles/other rows referencing
 * this one via categoryId/parentArticleId are SetNull (schema.prisma), so
 * a real hard delete is always safe here.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "docs", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const article = await prisma.docArticle.findUnique({ where: { id } });
  if (!article) return NextResponse.json({ error: "Article not found." }, { status: 404 });

  await prisma.docArticle.delete({ where: { id } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "docs.article.delete",
    resourceType: "DocArticle",
    resourceId: id,
    before: { slug: article.slug, status: article.status },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
