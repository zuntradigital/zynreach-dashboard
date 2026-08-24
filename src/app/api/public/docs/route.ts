import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";

interface DocCategoryLocaleText {
  name: string;
}

interface DocArticleLocaleText {
  title: string;
  seoTitle?: string;
  seoDescription?: string;
}

interface ArticleTreeNode {
  slug: string;
  title: string;
  order: number;
  version: string;
  seoTitle?: string;
  seoDescription?: string;
  children: ArticleTreeNode[];
}

/**
 * Knowledge Center §12.3/§12.4 Public Read: the Published DocCategory +
 * DocArticle tree that drives the "Persistent Left Navigation" (§12.4).
 * Documentation is direct-save (see the admin PATCH handler's docstring):
 * DocArticle.status is the definitive, immediate live/offline decision, so
 * this reads status directly rather than "ever published." Each category's
 * articles are nested into a tree via parentArticleId — same self-relation
 * hierarchy as System A's nav needs — and an article whose parent isn't
 * itself Published surfaces as a top-level entry in its category rather
 * than disappearing.
 */
export async function GET(request: Request) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const locale = searchParams.get("locale") === "ar" ? "ar" : "en";

  const [categories, articles] = await Promise.all([
    prisma.docCategory.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
    prisma.docArticle.findMany({ where: { status: "PUBLISHED" }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
  ]);

  const publishedIds = new Set(articles.map((a) => a.id));

  function toNode(article: (typeof articles)[number]): ArticleTreeNode {
    const text = (article.translations as unknown as Record<"en" | "ar", DocArticleLocaleText>)[locale];
    const children = articles
      .filter((a) => a.parentArticleId === article.id)
      .map(toNode);
    return {
      slug: article.slug,
      title: text.title,
      order: article.order,
      version: article.version,
      seoTitle: text.seoTitle,
      seoDescription: text.seoDescription,
      children,
    };
  }

  function topLevelFor(categoryId: string | null): ArticleTreeNode[] {
    return articles
      .filter((a) => a.categoryId === categoryId && (!a.parentArticleId || !publishedIds.has(a.parentArticleId)))
      .map(toNode);
  }

  const responseCategories = categories.map((category) => {
    const text = (category.translations as unknown as Record<"en" | "ar", DocCategoryLocaleText>)[locale];
    return {
      slug: category.slug,
      name: text.name,
      order: category.order,
      articles: topLevelFor(category.id),
    };
  });

  return NextResponse.json({ categories: responseCategories, uncategorized: topLevelFor(null) });
}
