import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";

interface DocArticleLocaleText {
  title: string;
  content: unknown[];
  seoTitle?: string;
  seoDescription?: string;
}

interface DocCategoryLocaleText {
  name: string;
}

function stub(article: { slug: string; order: number }, title: string) {
  return { slug: article.slug, title, order: article.order };
}

/**
 * Knowledge Center §12.3 Public Read: a single Published DocArticle, with
 * its resolved parent/children (for breadcrumb + in-page nav) and related
 * articles (relatedArticleSlugs — same JSON-string-array convention as
 * BlogPostVersion.relatedPostSlugs). Same service-token contract and
 * direct-save status semantics as the list route.
 */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const { slug } = await context.params;
  const { searchParams } = new URL(request.url);
  const locale = searchParams.get("locale") === "ar" ? "ar" : "en";

  const article = await prisma.docArticle.findUnique({
    where: { slug },
    include: { category: true, parentArticle: true, childArticles: { where: { status: "PUBLISHED" }, orderBy: [{ order: "asc" }] } },
  });
  if (!article || article.status !== "PUBLISHED") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const text = (article.translations as unknown as Record<"en" | "ar", DocArticleLocaleText>)[locale];
  const category = article.category
    ? (() => {
        const categoryText = (article.category!.translations as unknown as Record<"en" | "ar", DocCategoryLocaleText>)[locale];
        return { slug: article.category!.slug, name: categoryText.name };
      })()
    : null;

  const parent =
    article.parentArticle && article.parentArticle.status === "PUBLISHED"
      ? stub(article.parentArticle, (article.parentArticle.translations as unknown as Record<"en" | "ar", DocArticleLocaleText>)[locale].title)
      : null;

  const children = article.childArticles.map((child) =>
    stub(child, (child.translations as unknown as Record<"en" | "ar", DocArticleLocaleText>)[locale].title)
  );

  // JSON string array (MySQL/Prisma has no array scalar type — see
  // DocArticle.relatedArticleSlugs' schema comment); this application
  // always writes it as a string[], so the cast is safe.
  const relatedArticleSlugs = article.relatedArticleSlugs as string[];
  const relatedArticles = relatedArticleSlugs.length
    ? await prisma.docArticle.findMany({ where: { slug: { in: relatedArticleSlugs }, status: "PUBLISHED" } })
    : [];
  const responseRelated = relatedArticles.map((related) =>
    stub(related, (related.translations as unknown as Record<"en" | "ar", DocArticleLocaleText>)[locale].title)
  );

  return NextResponse.json({
    article: {
      slug: article.slug,
      title: text.title,
      content: text.content,
      order: article.order,
      version: article.version,
      updatedAt: article.updatedAt.toISOString(),
      seoTitle: text.seoTitle,
      seoDescription: text.seoDescription,
      category,
      parent,
      children,
      relatedArticles: responseRelated,
    },
  });
}
