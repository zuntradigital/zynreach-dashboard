import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { saveCustomerStoryVersionSchema } from "@/lib/validation";

/** Customer Story Editor load: story, version history, Approval trail. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "customerStories", "view");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const story = await prisma.customerStory.findUnique({
    where: { id },
    include: {
      customerLogo: true,
      currentVersion: { include: { testimonialPhoto: true } },
      versions: { orderBy: { versionNumber: "desc" } },
    },
  });
  if (!story) return NextResponse.json({ error: "Customer story not found." }, { status: 404 });

  const [approvals, scheduledPublications] = await Promise.all([
    prisma.approval.findMany({
      where: { resourceType: "CustomerStory", resourceId: id },
      orderBy: { decidedAt: "desc" },
      include: { actor: { select: { name: true, email: true } } },
    }),
    prisma.scheduledPublication.findMany({
      where: { resourceType: "CustomerStory", resourceId: id },
      orderBy: { createdAt: "desc" },
      take: 1,
    }),
  ]);

  return NextResponse.json({ story: { ...story, approvals, scheduledPublications } });
}

/**
 * Customer Story Save — intentionally bypasses the governed Draft ->
 * Submit -> Approve -> Publish workflow that Pages/Pricing still use, same
 * direct-save contract as Blog/Resources/Webinars (see their own PATCH
 * handlers' docstrings): the admin explicitly picks the story's live
 * status on every save, and that decision takes effect immediately. Creates
 * a NEW CustomerStoryVersion (immutable, matching every other *Version
 * model) and writes the chosen status straight onto CustomerStory.status in
 * the same transaction; publishedAt is stamped only when the chosen status
 * is PUBLISHED. The public customer-stories API reads
 * CustomerStory.status/currentVersion directly (not "last published
 * version"), so Draft/Archived really do take a story offline immediately,
 * and Published really does put the edited content live immediately.
 *
 * Two publish-time rules are enforced here, not just hidden in the UI
 * (§17 "Publishing permissions and validation must be enforced at the
 * actual backend/API authorization level"), mirroring Blog's PATCH exactly:
 *  - customerStories:publish gate — an actor who only holds
 *    customerStories:edit can still create/edit/save a story, but a
 *    PUBLISHED choice from them is silently coerced to DRAFT rather than
 *    rejected, so their other edits aren't lost; the story simply stays
 *    unavailable until an actor who holds customerStories:publish
 *    publishes it.
 *  - Completeness gate — an actor who *does* hold customerStories:publish
 *    still can't publish unless both locales have a non-empty challenge,
 *    solution, results, and testimonial quote; this one is a hard 400 (not
 *    a silent coercion) naming exactly what's missing. Unlike Blog there is
 *    no required-image gate — a customer logo/testimonial photo is
 *    editorially nice-to-have, not a publish blocker.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "customerStories", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const story = await prisma.customerStory.findUnique({ where: { id }, include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } });
  if (!story) return NextResponse.json({ error: "Customer story not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = saveCustomerStoryVersionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid customer story values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const {
    status: requestedStatus,
    customerName,
    customerLogoId,
    industry,
    companySize,
    country,
    featured,
    testimonialName,
    testimonialTitle,
    testimonialCompany,
    testimonialPhotoId,
    relatedCapabilitySlugs,
    translations,
  } = parsed.data;

  const canPublish = hasPermission(auth.context.effective, "customerStories", "publish");
  const canArchive = hasPermission(auth.context.effective, "customerStories", "archive");

  let status = requestedStatus;
  let coercedFromPublish = false;
  if (requestedStatus === "PUBLISHED") {
    if (!canPublish) {
      status = "DRAFT";
      coercedFromPublish = true;
    } else {
      const missing: ("en" | "ar")[] = [];
      if (!translations.en.challenge.trim() || !translations.en.solution.trim() || !translations.en.results.trim() || !translations.en.testimonialQuote.trim()) missing.push("en");
      if (!translations.ar.challenge.trim() || !translations.ar.solution.trim() || !translations.ar.results.trim() || !translations.ar.testimonialQuote.trim()) missing.push("ar");
      if (missing.length > 0) {
        return NextResponse.json({ error: "Cannot publish — required content is missing.", missing }, { status: 400 });
      }
    }
  } else if (requestedStatus === "ARCHIVED" && !canArchive) {
    // Same silent-coercion pattern as the Publish gate above — Archive is
    // an independent permission from Edit/Publish (see workflow.ts's own
    // Delete-vs-Archive note).
    status = "DRAFT";
  }

  const nextVersionNumber = (story.versions[0]?.versionNumber ?? 0) + 1;
  const now = new Date();
  const publishing = status === "PUBLISHED";

  const updated = await prisma.$transaction(async (tx) => {
    const version = await tx.customerStoryVersion.create({
      data: {
        customerStoryId: story.id,
        versionNumber: nextVersionNumber,
        testimonialName,
        testimonialTitle,
        testimonialCompany,
        testimonialPhotoId,
        relatedCapabilitySlugs,
        translations: translations as unknown as Prisma.InputJsonValue,
        createdByUserId: auth.context.adminUser.id,
        publishedAt: publishing ? now : null,
        publishedByUserId: publishing ? auth.context.adminUser.id : null,
      },
    });
    return tx.customerStory.update({
      where: { id: story.id },
      data: {
        currentVersionId: version.id,
        status,
        customerName,
        customerLogoId,
        industry,
        companySize,
        country,
        featured,
        submittedByUserId: null,
        reviewComment: null,
      },
      include: { currentVersion: true },
    });
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "customerStories.save",
    resourceType: "CustomerStory",
    resourceId: story.id,
    before: { status: story.status },
    after: { status, versionNumber: nextVersionNumber },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", story: updated, coercedFromPublish });
}

/**
 * Delete — always available (no status/everPublished gate the way the old
 * governed workflow enforced), matching Blog/Resources/Webinars/Careers'
 * "Delete" model. Nothing else has an FK depending on a CustomerStory's
 * identity (CustomerStoryVersion cascades with it), so a real hard delete
 * is always safe here.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "customerStories", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const story = await prisma.customerStory.findUnique({ where: { id } });
  if (!story) return NextResponse.json({ error: "Customer story not found." }, { status: 404 });

  await prisma.customerStory.delete({ where: { id } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "customerStories.delete",
    resourceType: "CustomerStory",
    resourceId: id,
    before: { slug: story.slug, status: story.status },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
