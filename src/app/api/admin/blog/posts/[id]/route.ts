import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { saveBlogPostVersionSchema } from "@/lib/validation";
import { hasMeaningfulContent, type ArticleBlock } from "@/lib/blog/article-blocks";

/** SCR-006 Blog Post Editor load: post, version history, Approval trail. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "blog", "view");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const post = await prisma.blogPost.findUnique({
    where: { id },
    include: {
      author: true,
      currentVersion: { include: { categories: { include: { category: true } }, tags: { include: { tag: true } }, heroImage: true } },
      versions: { orderBy: { versionNumber: "desc" } },
    },
  });
  if (!post) return NextResponse.json({ error: "Post not found." }, { status: 404 });

  const [approvals, scheduledPublications] = await Promise.all([
    prisma.approval.findMany({
      where: { resourceType: "BlogPost", resourceId: id },
      orderBy: { decidedAt: "desc" },
      include: { actor: { select: { name: true, email: true } } },
    }),
    prisma.scheduledPublication.findMany({
      where: { resourceType: "BlogPost", resourceId: id },
      orderBy: { createdAt: "desc" },
      take: 1,
    }),
  ]);

  return NextResponse.json({ post: { ...post, approvals, scheduledPublications } });
}

/**
 * Blog Save — intentionally bypasses the governed Draft -> Submit ->
 * Approve -> Publish workflow that Pages/Resources still use.
 * Business requirement: the admin explicitly picks the post's live
 * status (Draft, Published, or Archived) on every save, and that decision
 * must take effect immediately — no separate publish/archive step.
 * Creates a NEW BlogPostVersion (still immutable, matching
 * PageVersion/PricingVersion) and writes the chosen status straight onto
 * BlogPost.status in the same transaction; publishedAt is stamped only
 * when the chosen status is PUBLISHED. The public blog API reads
 * BlogPost.status/currentVersion directly (not "last published version"),
 * so Draft/Archived really do take a post offline immediately, and
 * Published really does put the edited content live immediately.
 *
 * Two publish-time rules are enforced here, not just hidden in the UI
 * (§17 "Publishing permissions and validation must be enforced at the
 * actual backend/API authorization level"):
 *  - blog:publish gate — an actor who only holds blog:edit can still
 *    create/edit/save an article, but a PUBLISHED choice from them is
 *    silently coerced to DRAFT rather than rejected, so their other edits
 *    aren't lost; the article simply stays unavailable until an actor who
 *    holds blog:publish (Content Manager/Publisher/Super Administrator)
 *    publishes it. Same reasoning covers heroImageId: a request from a
 *    non-publisher can never add/change the cover image, so it's pinned
 *    to whatever the current version already has.
 *  - Completeness gate — an actor who *does* hold blog:publish still can't
 *    publish unless both locales have real body content and a cover image
 *    is set; this one is a hard 400 (not a silent coercion) naming exactly
 *    what's missing, since a would-be publisher acting on incomplete
 *    content is a mistake to surface, not a permission boundary to work
 *    around quietly.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "blog", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const post = await prisma.blogPost.findUnique({ where: { id }, include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } });
  if (!post) return NextResponse.json({ error: "Post not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = saveBlogPostVersionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid post values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { status: requestedStatus, authorId, featured, publishedDate, updatedDate, heroImageId: requestedHeroImageId, relatedPostSlugs, categoryIds, tagIds, translations } = parsed.data;

  if (authorId) {
    const authorExists = await prisma.author.findUnique({ where: { id: authorId }, select: { id: true } });
    if (!authorExists) return NextResponse.json({ error: "Author does not exist." }, { status: 400 });
  }
  if (categoryIds.length > 0) {
    const found = await prisma.category.count({ where: { id: { in: categoryIds } } });
    if (found !== new Set(categoryIds).size) return NextResponse.json({ error: "One or more category IDs do not exist." }, { status: 400 });
  }
  if (tagIds.length > 0) {
    const found = await prisma.tag.count({ where: { id: { in: tagIds } } });
    if (found !== new Set(tagIds).size) return NextResponse.json({ error: "One or more tag IDs do not exist." }, { status: 400 });
  }

  const canPublish = hasPermission(auth.context.effective, "blog", "publish");
  const canArchive = hasPermission(auth.context.effective, "blog", "archive");
  const existingHeroImageId = post.versions[0]?.heroImageId ?? null;
  const heroImageId = canPublish ? requestedHeroImageId : existingHeroImageId;

  let status = requestedStatus;
  let coercedFromPublish = false;
  if (requestedStatus === "PUBLISHED") {
    if (!canPublish) {
      status = "DRAFT";
      coercedFromPublish = true;
    } else {
      const missing: ("en" | "ar" | "image")[] = [];
      // Title/excerpt are only required at publish time (not for every
      // Draft autosave) — a live public article needs both, but an
      // in-progress Draft shouldn't be blocked from saving just because
      // the admin hasn't typed a title yet.
      if (!translations.en.title.trim() || !translations.en.excerpt.trim() || !hasMeaningfulContent(translations.en.body as ArticleBlock[])) missing.push("en");
      if (!translations.ar.title.trim() || !translations.ar.excerpt.trim() || !hasMeaningfulContent(translations.ar.body as ArticleBlock[])) missing.push("ar");
      if (!heroImageId) missing.push("image");
      if (missing.length > 0) {
        return NextResponse.json({ error: "Cannot publish — required content is missing.", missing }, { status: 400 });
      }
    }
  } else if (requestedStatus === "ARCHIVED" && !canArchive) {
    // Same silent-coercion pattern as the Publish gate above — Archive is
    // an independent permission from Edit/Publish (see workflow.ts's own
    // Delete-vs-Archive note); an actor with Edit but not Archive can
    // still save other changes, they just can't move the post to Archived.
    status = "DRAFT";
  }

  const nextVersionNumber = (post.versions[0]?.versionNumber ?? 0) + 1;
  const now = new Date();
  const publishing = status === "PUBLISHED";

  const updated = await prisma.$transaction(async (tx) => {
    const version = await tx.blogPostVersion.create({
      data: {
        blogPostId: post.id,
        versionNumber: nextVersionNumber,
        publishedDate,
        updatedDate,
        heroImageId,
        relatedPostSlugs,
        translations: translations as unknown as Prisma.InputJsonValue,
        createdByUserId: auth.context.adminUser.id,
        publishedAt: publishing ? now : null,
        publishedByUserId: publishing ? auth.context.adminUser.id : null,
        categories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
        tags: { create: tagIds.map((tagId) => ({ tagId })) },
      },
    });
    return tx.blogPost.update({
      where: { id: post.id },
      data: { currentVersionId: version.id, status, authorId, featured, submittedByUserId: null, reviewComment: null },
      include: { currentVersion: { include: { categories: { include: { category: true } }, tags: { include: { tag: true } } } } },
    });
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "blog.save",
    resourceType: "BlogPost",
    resourceId: post.id,
    before: { status: post.status },
    after: { status, versionNumber: nextVersionNumber },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", post: updated, coercedFromPublish });
}

/**
 * Delete — always available (no status/everPublished gate the way the
 * old governed workflow enforced), matching Careers' "Delete Job" model.
 * Nothing else has an FK depending on a BlogPost's identity
 * (BlogPostVersion, and its Category/Tag join rows, cascade with it —
 * the Categories/Tags themselves are untouched), so a real hard delete
 * is always safe here.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "blog", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const post = await prisma.blogPost.findUnique({ where: { id } });
  if (!post) return NextResponse.json({ error: "Post not found." }, { status: 404 });

  await prisma.blogPost.delete({ where: { id } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "blog.delete",
    resourceType: "BlogPost",
    resourceId: id,
    before: { slug: post.slug, status: post.status },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
