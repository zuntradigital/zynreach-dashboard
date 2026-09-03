import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { updateJobApplicationSchema } from "@/lib/validation";
import { deletePrivateFile } from "@/lib/media/storage";

/** Careers → Applications detail — full submitted application data, plus the resolved job (if the JobListing still exists). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "careers", "view");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const application = await prisma.jobApplication.findUnique({
    where: { id },
    include: { jobListing: { select: { id: true, slug: true, status: true, currentVersion: { select: { translations: true } } } } },
  });
  if (!application) return NextResponse.json({ error: "Application not found." }, { status: 404 });

  return NextResponse.json({ application });
}

/** Review-state tracking (NEW/REVIEWED/ARCHIVED) — careers:edit, same permission that already governs everything else in this module. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "careers", "edit");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = updateJobApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status value.", issues: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.jobApplication.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Application not found." }, { status: 404 });

  const application = await prisma.jobApplication.update({
    where: { id },
    data: { status: parsed.data.status },
    include: { jobListing: { select: { id: true, slug: true, status: true, currentVersion: { select: { translations: true } } } } },
  });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "job_application.update",
    resourceType: "JobApplication",
    resourceId: id,
    before: { status: existing.status },
    after: { status: application.status },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", application });
}

/**
 * Hard delete — careers:delete, the same permission that already governs
 * deleting a JobListing itself. Also removes the applicant's private
 * resume file from disk (private-uploads/), so a delete here doesn't
 * leave an orphaned file with no database row pointing at it.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "careers", "delete");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const ipAddress = getClientIp(request);

  const application = await prisma.jobApplication.findUnique({ where: { id } });
  if (!application) return NextResponse.json({ error: "Application not found." }, { status: 404 });

  await prisma.jobApplication.delete({ where: { id } });
  await deletePrivateFile(application.resumeUrl);

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "job_application.delete",
    resourceType: "JobApplication",
    resourceId: id,
    before: { fullName: application.fullName, email: application.email, jobTitleSnapshot: application.jobTitleSnapshot },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success" });
}
