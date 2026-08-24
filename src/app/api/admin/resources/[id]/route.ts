import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { saveResourceVersionSchema } from "@/lib/validation";

/** SCR-008 Resource Editor load: resource, version history, Approval trail. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "resources", "view");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const resource = await prisma.resource.findUnique({
    where: { id },
    include: { currentVersion: true, downloadFile: true, versions: { orderBy: { versionNumber: "desc" } } },
  });
  if (!resource) return NextResponse.json({ error: "Resource not found." }, { status: 404 });

  const [approvals, scheduledPublications] = await Promise.all([
    prisma.approval.findMany({
      where: { resourceType: "Resource", resourceId: id },
      orderBy: { decidedAt: "desc" },
      include: { actor: { select: { name: true, email: true } } },
    }),
    prisma.scheduledPublication.findMany({
      where: { resourceType: "Resource", resourceId: id },
      orderBy: { createdAt: "desc" },
      take: 1,
    }),
  ]);

  return NextResponse.json({ resource: { ...resource, approvals, scheduledPublications } });
}

/**
 * Resource Save — direct-save, matching Blog/Pricing/Pages/Careers (see
 * their own PATCH handlers' docstrings). The admin picks the resource's
 * live status on every save, and that decision takes effect immediately —
 * no separate Draft -> Submit -> Approve -> Publish gate. Creates a NEW
 * ResourceVersion (immutable snapshot, as before) and writes the chosen
 * status straight onto Resource.status in the same transaction;
 * publishedAt is stamped only when the chosen status is PUBLISHED. The
 * public resources API reads Resource.status/currentVersion directly, so a
 * Draft/Archived choice takes a resource offline immediately too, and
 * Published puts the edited content live immediately.
 *
 * resources:publish gate: an actor who only holds resources:edit can
 * still create/edit/save a resource, but a PUBLISHED choice from them is
 * silently coerced to DRAFT rather than rejected, matching the
 * equivalent gate in the Blog/Pricing/Pages/Careers PATCH routes.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "resources", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const resource = await prisma.resource.findUnique({ where: { id }, include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } });
  if (!resource) return NextResponse.json({ error: "Resource not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = saveResourceVersionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid resource values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { status, gated, category, targetAudience, difficultyLevel, relatedResourceSlugs, translations } = parsed.data;

  const canPublish = hasPermission(auth.context.effective, "resources", "publish");
  const canArchive = hasPermission(auth.context.effective, "resources", "archive");
  const finalStatus = (status === "PUBLISHED" && !canPublish) || (status === "ARCHIVED" && !canArchive) ? "DRAFT" : status;
  // downloadFileId gated behind resources:publish, same reasoning as
  // Blog's heroImageId (see that PATCH handler's docstring) — pinned to
  // whatever the resource already has if the actor can't publish.
  const downloadFileId = canPublish ? parsed.data.downloadFileId : resource.downloadFileId;

  const nextVersionNumber = (resource.versions[0]?.versionNumber ?? 0) + 1;
  const now = new Date();
  const publishing = finalStatus === "PUBLISHED";

  const updated = await prisma.$transaction(async (tx) => {
    const version = await tx.resourceVersion.create({
      data: {
        resourceId: resource.id,
        versionNumber: nextVersionNumber,
        category,
        targetAudience,
        difficultyLevel,
        relatedResourceSlugs: relatedResourceSlugs as unknown as Prisma.InputJsonValue,
        translations: translations as unknown as Prisma.InputJsonValue,
        createdByUserId: auth.context.adminUser.id,
        publishedAt: publishing ? now : null,
      },
    });
    return tx.resource.update({
      where: { id: resource.id },
      data: { status: finalStatus, gated, downloadFileId, currentVersionId: version.id, submittedByUserId: null, reviewComment: null },
      include: { currentVersion: true, downloadFile: true },
    });
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "resources.save",
    resourceType: "Resource",
    resourceId: resource.id,
    before: { status: resource.status },
    after: { status: finalStatus, versionNumber: nextVersionNumber },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", resource: updated });
}

/**
 * Delete — always available (no status/everPublished gate the way the old
 * governed workflow enforced), matching Blog/Pricing/Pages/Careers'
 * "Delete" model. Nothing else has an FK depending on a Resource's
 * identity (ResourceVersion cascades with it), so a real hard delete is
 * always safe here.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "resources", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const resource = await prisma.resource.findUnique({ where: { id } });
  if (!resource) return NextResponse.json({ error: "Resource not found." }, { status: 404 });

  await prisma.resource.delete({ where: { id } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "resources.delete",
    resourceType: "Resource",
    resourceId: id,
    before: { slug: resource.slug, status: resource.status },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
