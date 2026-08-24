import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { saveJobListingVersionSchema } from "@/lib/validation";

/** SCR-015 detail load: listing, version history, Approval trail. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "careers", "view");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const listing = await prisma.jobListing.findUnique({
    where: { id },
    include: { currentVersion: true, versions: { orderBy: { versionNumber: "desc" } } },
  });
  if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });

  const [approvals, scheduledPublications] = await Promise.all([
    prisma.approval.findMany({
      where: { resourceType: "JobListing", resourceId: id },
      orderBy: { decidedAt: "desc" },
      include: { actor: { select: { name: true, email: true } } },
    }),
    prisma.scheduledPublication.findMany({
      where: { resourceType: "JobListing", resourceId: id },
      orderBy: { createdAt: "desc" },
      take: 1,
    }),
  ]);

  return NextResponse.json({ listing: { ...listing, approvals, scheduledPublications } });
}

/**
 * Careers Save — intentionally bypasses the governed Draft → Submit →
 * Approve → Publish workflow that Pages/Resources still use. The admin
 * picks the listing's live status (Draft or Published) on every save, and
 * that decision takes effect immediately — no separate publish step.
 * Creates a NEW JobListingVersion (immutable snapshot, as before) and
 * writes the chosen status straight onto JobListing.status in the same
 * transaction; publishedAt is stamped only when the chosen status is
 * PUBLISHED. The public careers API reads JobListing.status/currentVersion
 * directly, so a Draft choice takes a listing offline immediately too.
 *
 * careers:publish gate: an actor who only holds careers:edit can still
 * create/edit/save a listing, but a PUBLISHED choice from them is
 * silently coerced to DRAFT rather than rejected, matching the
 * equivalent gate in the Blog/Pricing/Pages PATCH routes.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "careers", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const listing = await prisma.jobListing.findUnique({ where: { id }, include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } });
  if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = saveJobListingVersionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid listing values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { status, datePosted, translations } = parsed.data;
  const canPublish = hasPermission(auth.context.effective, "careers", "publish");
  const canArchive = hasPermission(auth.context.effective, "careers", "archive");
  const finalStatus = (status === "PUBLISHED" && !canPublish) || (status === "ARCHIVED" && !canArchive) ? "DRAFT" : status;

  const nextVersionNumber = (listing.versions[0]?.versionNumber ?? 0) + 1;
  const now = new Date();
  const publishing = finalStatus === "PUBLISHED";

  const updated = await prisma.$transaction(async (tx) => {
    const version = await tx.jobListingVersion.create({
      data: {
        jobListingId: listing.id,
        versionNumber: nextVersionNumber,
        datePosted,
        translations: translations as unknown as Prisma.InputJsonValue,
        createdByUserId: auth.context.adminUser.id,
        publishedAt: publishing ? now : null,
        publishedByUserId: publishing ? auth.context.adminUser.id : null,
      },
    });
    return tx.jobListing.update({
      where: { id: listing.id },
      data: { currentVersionId: version.id, status: finalStatus, submittedByUserId: null, reviewComment: null },
      include: { currentVersion: true },
    });
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "careers.save",
    resourceType: "JobListing",
    resourceId: listing.id,
    before: { status: listing.status },
    after: { status: finalStatus, versionNumber: nextVersionNumber },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", listing: updated });
}

/**
 * "Delete Job" — always available (no status/everPublished gate the way
 * Pages/Resources still enforce), but the underlying operation depends on
 * whether the listing was ever live: a listing that was ever Published
 * gets soft-deleted (status -> ARCHIVED, already excluded from the public
 * careers API) rather than physically removed, specifically so its row —
 * and therefore any JobApplication rows pointing at it — is never
 * touched. A listing that was never published (no candidate could ever
 * have applied to it) is hard-deleted for real, matching the cleanup
 * behavior every other content module still uses for pristine drafts.
 * Either way the externally visible result is identical: gone from the
 * public Careers site.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "careers", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const listing = await prisma.jobListing.findUnique({ where: { id }, include: { versions: { select: { publishedAt: true } } } });
  if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });

  const everPublished = listing.versions.some((v) => v.publishedAt !== null);

  if (everPublished) {
    await prisma.jobListing.update({ where: { id }, data: { status: "ARCHIVED" } });
  } else {
    await prisma.jobListing.delete({ where: { id } });
  }

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "careers.delete",
    resourceType: "JobListing",
    resourceId: id,
    before: { slug: listing.slug, status: listing.status },
    after: { mode: everPublished ? "soft" : "hard" },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
