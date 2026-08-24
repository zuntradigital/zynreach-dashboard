import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { savePageDraftSchema } from "@/lib/validation";

/** SCR-003 detail load: Page, its version history, and its Approval trail. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "content", "view");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const page = await prisma.page.findUnique({
    where: { id },
    include: {
      currentVersion: true,
      versions: { orderBy: { versionNumber: "desc" } },
    },
  });
  if (!page) return NextResponse.json({ error: "Page not found." }, { status: 404 });

  // No DB-level FK to Approval/ScheduledPublication since the generalized
  // resourceType/resourceId shape (shared with Pricing) can't express one —
  // same application-level join AuditLog already uses for its own
  // resourceType/resourceId pair.
  const [approvals, scheduledPublications] = await Promise.all([
    prisma.approval.findMany({
      where: { resourceType: "Page", resourceId: id },
      orderBy: { decidedAt: "desc" },
      include: { actor: { select: { name: true, email: true } } },
    }),
    prisma.scheduledPublication.findMany({
      where: { resourceType: "Page", resourceId: id },
      orderBy: { createdAt: "desc" },
      take: 1,
    }),
  ]);

  return NextResponse.json({ page: { ...page, approvals, scheduledPublications } });
}

/**
 * Page Save — intentionally bypasses the governed Draft -> Submit ->
 * Approve -> Publish workflow (matching Blog/Pricing/Careers, see their
 * own PATCH handlers' docstrings). The admin picks the page's live status
 * on every save, and that decision takes effect immediately — no separate
 * publish/archive step. Creates a NEW PageVersion (immutable snapshot, as
 * before) and writes the chosen status straight onto Page.status in the
 * same transaction; publishedAt is stamped only when the chosen status is
 * PUBLISHED. The public pages API reads Page.status/currentVersion
 * directly, so a Draft/Archived choice takes a page offline immediately
 * too, and Published puts the edited content live immediately.
 *
 * content:publish / content:archive gates: an actor who only holds
 * content:edit can still edit/save a page, but a PUBLISHED or ARCHIVED
 * choice from them is silently coerced to DRAFT rather than rejected, so
 * their other edits aren't lost — matching the equivalent gate in the
 * Blog/Resources/Careers PATCH routes. Independent of each other: a role
 * can hold content:publish without content:archive, or vice versa.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "content", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const page = await prisma.page.findUnique({ where: { id }, include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } });
  if (!page) return NextResponse.json({ error: "Page not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = savePageDraftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid page values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { status, title, componentBlocks } = parsed.data;
  const canPublish = hasPermission(auth.context.effective, "content", "publish");
  const canArchive = hasPermission(auth.context.effective, "content", "archive");
  const finalStatus = (status === "PUBLISHED" && !canPublish) || (status === "ARCHIVED" && !canArchive) ? "DRAFT" : status;
  const nextVersionNumber = (page.versions[0]?.versionNumber ?? 0) + 1;
  const now = new Date();
  const publishing = finalStatus === "PUBLISHED";

  const updated = await prisma.$transaction(async (tx) => {
    const version = await tx.pageVersion.create({
      data: {
        pageId: page.id,
        versionNumber: nextVersionNumber,
        title,
        componentBlocks: componentBlocks as unknown as Prisma.InputJsonValue,
        createdByUserId: auth.context.adminUser.id,
        publishedAt: publishing ? now : null,
      },
    });
    return tx.page.update({
      where: { id: page.id },
      data: { title, status: finalStatus, currentVersionId: version.id, submittedByUserId: null, reviewComment: null },
      include: { currentVersion: true },
    });
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "page.save",
    resourceType: "Page",
    resourceId: page.id,
    before: { status: page.status },
    after: { status: finalStatus, versionNumber: nextVersionNumber, title },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", page: updated });
}

/**
 * Delete — always available (no status/everPublished gate the way the
 * old governed workflow enforced), matching Blog/Pricing/Careers' "Delete"
 * model. Nothing else has an FK depending on a Page's identity
 * (PageVersion cascades with it), so a real hard delete is always safe
 * here.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "content", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const page = await prisma.page.findUnique({ where: { id } });
  if (!page) return NextResponse.json({ error: "Page not found." }, { status: 404 });

  await prisma.page.delete({ where: { id } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "page.delete",
    resourceType: "Page",
    resourceId: id,
    before: { slug: page.slug, title: page.title, status: page.status },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
