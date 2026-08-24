import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";
import { executeDueBlogPublications } from "@/lib/content/scheduler";

interface LocaleText {
  title: string;
  excerpt: string;
  seoTitle?: string;
  seoDescription?: string;
  canonicalUrl?: string;
  noIndex?: boolean;
  body: unknown[];
}

/**
 * SRS §29 Public Read: Published BlogPost set. Service-token authenticated,
 * same contract as Pages/Pricing's public routes. Resolves each post's
 * requested-locale translations, category, tags, and author into the exact
 * BlogPost/BlogAuthor shape System A's src/types/content.ts already
 * expects, so wiring System A means swapping the data source, not the
 * rendering contract.
 */
export async function GET(request: Request) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  await executeDueBlogPublications();

  const { searchParams } = new URL(request.url);
  const locale = searchParams.get("locale") === "ar" ? "ar" : "en";

  // Blog is direct-save (see the admin PATCH handler's docstring): the
  // admin's chosen status is the definitive, immediate live/offline
  // decision, so this reads BlogPost.status/currentVersion directly
  // rather than "last published version" — a post the admin just set to
  // Draft must disappear now, not keep showing an older Published copy.
  const posts = await prisma.blogPost.findMany({
    where: { status: "PUBLISHED" },
    include: {
      author: true,
      currentVersion: { include: { categories: { include: { category: true } }, tags: { include: { tag: true } }, heroImage: true } },
    },
  });

  const origin = new URL(request.url).origin;
  const authorIds = new Set<string>();
  const responsePosts = posts
    .filter((post) => post.currentVersion !== null)
    .map((post) => {
      const version = post.currentVersion!;
      const text = (version.translations as unknown as Record<"en" | "ar", LocaleText>)[locale];
      const category = version.categories[0]?.category;
      const categoryText = category ? (category.translations as unknown as Record<"en" | "ar", { name: string }>)[locale] : null;
      if (post.authorId) authorIds.add(post.authorId);

      return {
        slug: post.slug,
        title: text.title,
        excerpt: text.excerpt,
        category: categoryText?.name ?? "",
        tags: version.tags.map((t) => (t.tag.translations as unknown as Record<"en" | "ar", { name: string }>)[locale].name),
        authorId: post.authorId ?? "",
        publishedDate: (version.publishedDate ?? version.publishedAt ?? post.createdAt).toISOString().slice(0, 10),
        updatedDate: version.updatedDate ? version.updatedDate.toISOString().slice(0, 10) : undefined,
        body: text.body,
        relatedSlugs: version.relatedPostSlugs,
        featured: post.featured,
        image: version.heroImage ? (version.heroImage.url.startsWith("http") ? version.heroImage.url : `${origin}${version.heroImage.url}`) : undefined,
        imageAlt: version.heroImage?.altText,
        seoTitle: text.seoTitle,
        seoDescription: text.seoDescription,
        canonicalUrl: text.canonicalUrl,
        noIndex: text.noIndex,
      };
    });

  const authors = await prisma.author.findMany({ where: { id: { in: Array.from(authorIds) } } });
  const responseAuthors = authors.map((author) => {
    const text = (author.translations as unknown as Record<"en" | "ar", { name: string; role: string; bio: string }>)[locale];
    return { id: author.id, name: text.name, role: text.role, bio: text.bio };
  });

  return NextResponse.json({ posts: responsePosts, authors: responseAuthors });
}
