import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { createBlogPostSchema, blogPostsQuerySchema } from "@/lib/validation";
import { executeDueBlogPublications } from "@/lib/content/scheduler";

const EMPTY_LOCALE_TEXT = { title: "", excerpt: "", body: [] };

/** SCR-005 Blog Post List. blog:view permission. */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "blog", "view");
  if (!auth.ok) return auth.response;

  await executeDueBlogPublications();

  const { searchParams } = new URL(request.url);
  const parsed = blogPostsQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }
  const { status, page, take } = parsed.data;

  const where: Prisma.BlogPostWhereInput = status ? { status } : {};

  const [posts, total] = await Promise.all([
    prisma.blogPost.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * take,
      take,
      include: {
        author: { select: { translations: true } },
        currentVersion: {
          select: { translations: true, publishedDate: true, heroImage: { select: { url: true, altText: true } } },
        },
      },
    }),
    prisma.blogPost.count({ where }),
  ]);

  return NextResponse.json({ posts, total, page, take });
}

/**
 * SCR-006 "New Post." Creates the BlogPost plus its first, empty
 * BlogPostVersion (versionNumber 1) in one transaction — same "never
 * exists without at least one version" invariant as Page/PricingPlan.
 */
export async function POST(request: Request) {
  const auth = await requirePermission(request, "blog", "create");
  if (!auth.ok) return auth.response;

  const ipAddress = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = createBlogPostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid post values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { slug, authorId, featured } = parsed.data;

  const existing = await prisma.blogPost.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });
  }

  const post = await prisma.$transaction(async (tx) => {
    const created = await tx.blogPost.create({
      data: { slug, authorId, featured, status: "DRAFT", createdByUserId: auth.context.adminUser.id },
    });
    const version = await tx.blogPostVersion.create({
      data: {
        blogPostId: created.id,
        versionNumber: 1,
        relatedPostSlugs: [],
        translations: { en: EMPTY_LOCALE_TEXT, ar: EMPTY_LOCALE_TEXT } as unknown as Prisma.InputJsonValue,
        createdByUserId: auth.context.adminUser.id,
      },
    });
    return tx.blogPost.update({
      where: { id: created.id },
      data: { currentVersionId: version.id },
      include: { currentVersion: true },
    });
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "blog.create",
    resourceType: "BlogPost",
    resourceId: post.id,
    after: { slug, authorId, featured },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", post }, { status: 201 });
}
