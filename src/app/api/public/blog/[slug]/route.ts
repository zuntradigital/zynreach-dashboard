import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";

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
 * SRS §29 Public Read: a single Published BlogPost, plus its author and
 * resolved related-post stubs (title/excerpt only — the detail page's
 * BlogCard needs just enough to render a related-post tile, not the full
 * body). Same service-token contract as the list route.
 */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const { slug } = await context.params;
  const { searchParams } = new URL(request.url);
  const locale = searchParams.get("locale") === "ar" ? "ar" : "en";

  // Blog is direct-save: BlogPost.status/currentVersion is the definitive
  // live state, not "last published version" — see the list route's own
  // comment and the admin PATCH handler's docstring.
  const post = await prisma.blogPost.findUnique({
    where: { slug },
    include: {
      author: true,
      currentVersion: { include: { categories: { include: { category: true } }, tags: { include: { tag: true } }, heroImage: true } },
    },
  });
  if (!post || post.status !== "PUBLISHED" || !post.currentVersion) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const origin = new URL(request.url).origin;
  const version = post.currentVersion;
  // JSON string array (MySQL/Prisma has no array scalar type — see
  // BlogPostVersion.relatedPostSlugs' schema comment); this application
  // always writes it as a string[], so the cast is safe.
  const relatedPostSlugs = version.relatedPostSlugs as string[];
  const text = (version.translations as unknown as Record<"en" | "ar", LocaleText>)[locale];
  const category = version.categories[0]?.category;
  const categoryText = category ? (category.translations as unknown as Record<"en" | "ar", { name: string }>)[locale] : null;

  const responsePost = {
    slug: post.slug,
    title: text.title,
    excerpt: text.excerpt,
    category: categoryText?.name ?? "",
    tags: version.tags.map((t) => (t.tag.translations as unknown as Record<"en" | "ar", { name: string }>)[locale].name),
    authorId: post.authorId ?? "",
    publishedDate: (version.publishedDate ?? version.publishedAt ?? post.createdAt).toISOString().slice(0, 10),
    updatedDate: version.updatedDate ? version.updatedDate.toISOString().slice(0, 10) : undefined,
    body: text.body,
    relatedSlugs: relatedPostSlugs,
    featured: post.featured,
    image: version.heroImage ? (version.heroImage.url.startsWith("http") ? version.heroImage.url : `${origin}${version.heroImage.url}`) : undefined,
    imageAlt: version.heroImage?.altText,
    seoTitle: text.seoTitle,
    seoDescription: text.seoDescription,
    canonicalUrl: text.canonicalUrl,
    noIndex: text.noIndex,
  };

  const author = post.author
    ? (() => {
        const authorText = (post.author!.translations as unknown as Record<"en" | "ar", { name: string; role: string; bio: string }>)[locale];
        return { id: post.author!.id, name: authorText.name, role: authorText.role, bio: authorText.bio };
      })()
    : null;

  const relatedPosts = relatedPostSlugs.length
    ? await prisma.blogPost.findMany({
        where: { slug: { in: relatedPostSlugs }, status: "PUBLISHED" },
        include: { currentVersion: { include: { heroImage: true } } },
      })
    : [];
  const responseRelated = relatedPosts
    .filter((p) => p.currentVersion !== null)
    .map((p) => {
      const relVersion = p.currentVersion!;
      const relText = (relVersion.translations as unknown as Record<"en" | "ar", LocaleText>)[locale];
      return {
        slug: p.slug,
        title: relText.title,
        excerpt: relText.excerpt,
        category: "",
        tags: [],
        authorId: p.authorId ?? "",
        publishedDate: (relVersion.publishedDate ?? relVersion.publishedAt ?? p.createdAt).toISOString().slice(0, 10),
        body: [],
        relatedSlugs: [],
        featured: p.featured,
        image: relVersion.heroImage ? (relVersion.heroImage.url.startsWith("http") ? relVersion.heroImage.url : `${origin}${relVersion.heroImage.url}`) : undefined,
        imageAlt: relVersion.heroImage?.altText,
      };
    });

  return NextResponse.json({ post: responsePost, author, relatedPosts: responseRelated });
}
