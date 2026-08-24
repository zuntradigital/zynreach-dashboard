import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { leadsQuerySchema } from "@/lib/validation";
import { toCsv } from "@/lib/csv";

const CSV_COLUMNS = ["id", "formId", "status", "source", "campaign", "submittedAt", "crmSyncStatus"];

function serializeLead(lead: {
  id: string;
  status: string;
  source: string | null;
  campaign: string | null;
  crmSyncStatus: string | null;
  submission: { formId: string; submittedAt: Date };
}) {
  return {
    id: lead.id,
    status: lead.status,
    source: lead.source,
    campaign: lead.campaign,
    formId: lead.submission.formId,
    submittedAt: lead.submission.submittedAt,
    crmSyncStatus: lead.crmSyncStatus,
  };
}

/**
 * SCR-034's data source (Lead / Submission Inbox), plus the "recent 10"
 * summary the Dashboard Home widget already calls with just `?take=10` —
 * that existing call shape is preserved unchanged; filters/pagination/
 * CSV export below are additive query parameters, not a breaking change.
 * Session + leads:view (interactive AdminUser), distinct from the
 * ingest endpoint's service-token auth.
 */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "leads", "view");
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const parsed = leadsQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { status, source, formId, dateFrom, dateTo, page, take, format } = parsed.data;

  if (dateFrom && dateTo && dateFrom > dateTo) {
    return NextResponse.json({ error: "dateFrom must be before dateTo." }, { status: 400 });
  }

  // Career applications get dual-written here for backward-compat (see
  // POST /api/admin/leads/career-application's docstring) but now have
  // their own dedicated home — the JobApplication model, surfaced via
  // /api/admin/careers/applications and the Dashboard's Leads page "Job
  // Applicants" tab, with a real jobListingId relation rather than
  // Lead.campaign's arbitrary string. This Customer/Sales Leads endpoint
  // excludes them by default so the two categories aren't mixed in one
  // undifferentiated list; an admin can still explicitly request them via
  // ?formId=career-application if needed (nothing is deleted or hidden
  // from the database, only from this endpoint's default view).
  const submissionFilter: Prisma.SubmissionWhereInput = formId ? { formId } : { formId: { not: "career-application" } };
  if (dateFrom || dateTo) {
    submissionFilter.submittedAt = { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) };
  }

  const where: Prisma.LeadWhereInput = {
    ...(status ? { status } : {}),
    ...(source ? { source } : {}),
    submission: submissionFilter,
  };

  if (format === "csv") {
    // Independent from leads:view — a role can browse the inbox without
    // being able to bulk-export it (§30: "export actions are Audit
    // Logged with the exporting user and row count").
    if (!hasPermission(auth.context.effective, "leads", "export")) {
      await recordAudit({
        actorId: auth.context.adminUser.id,
        actorEmail: auth.context.adminUser.email,
        action: "leads:export",
        result: "DENIED",
        ipAddress: getClientIp(request),
        sessionId: auth.context.session.id,
      });
      return NextResponse.json({ error: "Permission denied." }, { status: 403 });
    }

    const rows = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 1000,
      include: { submission: { select: { formId: true, submittedAt: true } } },
    });
    const csv = toCsv(rows.map(serializeLead), CSV_COLUMNS);
    await recordAudit({
      actorId: auth.context.adminUser.id,
      actorEmail: auth.context.adminUser.email,
      action: "leads.export",
      result: "SUCCESS",
      after: { rowCount: rows.length },
      ipAddress: getClientIp(request),
      sessionId: auth.context.session.id,
    });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leads-export.csv"`,
      },
    });
  }

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * take,
      take,
      include: { submission: { select: { formId: true, submittedAt: true } } },
    }),
    prisma.lead.count({ where }),
  ]);

  return NextResponse.json({ leads: leads.map(serializeLead), total, page, take });
}
