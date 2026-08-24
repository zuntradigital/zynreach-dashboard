import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { updateLeadSchema } from "@/lib/validation";

function serializeLeadDetail(lead: {
  id: string;
  status: string;
  source: string | null;
  campaign: string | null;
  crmSyncStatus: string | null;
  crmSyncedAt: Date | null;
  createdAt: Date;
  assignedOwnerId: string | null;
  assignedOwner: { id: string; name: string | null; email: string } | null;
  submission: { formId: string; payload: unknown; utm: unknown; submittedAt: Date; ipHash: string | null };
}) {
  return {
    id: lead.id,
    status: lead.status,
    source: lead.source,
    campaign: lead.campaign,
    crmSyncStatus: lead.crmSyncStatus,
    crmSyncedAt: lead.crmSyncedAt,
    createdAt: lead.createdAt,
    assignedOwnerId: lead.assignedOwnerId,
    assignedOwner: lead.assignedOwner,
    submission: {
      formId: lead.submission.formId,
      payload: lead.submission.payload,
      utm: lead.submission.utm,
      submittedAt: lead.submission.submittedAt,
      ipHash: lead.submission.ipHash,
    },
  };
}

/** SCR-035 — Lead Detail. Same leads:view permission as the list endpoint. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "leads", "view");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: { submission: true, assignedOwner: { select: { id: true, name: true, email: true } } },
  });

  if (!lead) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  return NextResponse.json({ lead: serializeLeadDetail(lead) });
}

/**
 * SCR-035 — Reassign Owner (leads:edit) and status changes, including
 * Archive. Archive is checked as its own, independent permission
 * (leads:archive) — holding leads:edit alone is not enough to archive a
 * lead, matching the same Delete-vs-Archive-vs-Edit independence every
 * other module in this system enforces (workflow.ts's own note).
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "leads", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = updateLeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid lead values.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { assignedOwnerId, status } = parsed.data;

  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

  if (status === "ARCHIVED" && !hasPermission(auth.context.effective, "leads", "archive")) {
    await recordAudit({
      actorId: auth.context.adminUser.id,
      actorEmail: auth.context.adminUser.email,
      action: "leads:archive",
      result: "DENIED",
      ipAddress,
      sessionId: auth.context.session.id,
    });
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }

  if (assignedOwnerId) {
    const ownerExists = await prisma.adminUser.findUnique({ where: { id: assignedOwnerId }, select: { id: true } });
    if (!ownerExists) return NextResponse.json({ error: "Assigned owner does not exist." }, { status: 400 });
  }

  const updated = await prisma.lead.update({
    where: { id },
    data: {
      ...(assignedOwnerId !== undefined ? { assignedOwnerId } : {}),
      ...(status !== undefined ? { status } : {}),
    },
    include: { submission: true, assignedOwner: { select: { id: true, name: true, email: true } } },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "lead.update",
    resourceType: "Lead",
    resourceId: id,
    before: { status: lead.status, assignedOwnerId: lead.assignedOwnerId },
    after: { status: updated.status, assignedOwnerId: updated.assignedOwnerId },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", lead: serializeLeadDetail(updated) });
}

/**
 * Hard delete — leads:delete, independent of leads:edit/leads:archive.
 * Deletes the Submission (the raw form record), which cascades to the
 * Lead (onDelete: Cascade on Lead.submission — schema.prisma) rather
 * than leaving an orphaned Submission with no Lead view onto it.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "leads", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const lead = await prisma.lead.findUnique({ where: { id }, include: { submission: true } });
  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

  await prisma.submission.delete({ where: { id: lead.submissionId } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "lead.delete",
    resourceType: "Lead",
    resourceId: id,
    before: { status: lead.status, formId: lead.submission.formId },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
