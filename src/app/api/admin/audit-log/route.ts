import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { auditLogQuerySchema } from "@/lib/validation";
import { toCsv } from "@/lib/csv";

const CSV_COLUMNS = [
  "id",
  "createdAt",
  "actorEmail",
  "action",
  "resourceType",
  "resourceId",
  "result",
  "ipAddress",
  "sessionId",
];

/**
 * SCR-051 — Audit Log Explorer, FR-ADM-021/022. View-only by design: no
 * PATCH/DELETE handler exists in this file or anywhere else for
 * AuditLog, matching the SRS's "no UI or API path exists to edit or
 * delete an Audit Log record... enforced at the API layer" (§25).
 *
 * Per-role module-scoping ("Super Administrator sees all unscoped, other
 * roles are scoped to modules they hold View on") is not implemented —
 * see prisma/seed.ts's audit:view comment. Every role holding audit:view
 * currently sees the same result set.
 */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "audit", "view");
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const parsed = auditLogQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters.", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { action, result, actorEmail, resourceType, dateFrom, dateTo, page, take, format } = parsed.data;

  if (dateFrom && dateTo && dateFrom > dateTo) {
    return NextResponse.json({ error: "dateFrom must be before dateTo." }, { status: 400 });
  }

  const where: Prisma.AuditLogWhereInput = {
    ...(action ? { action } : {}),
    ...(result ? { result } : {}),
    ...(actorEmail ? { actorEmail } : {}),
    ...(resourceType ? { resourceType } : {}),
    ...(dateFrom || dateTo
      ? { createdAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } }
      : {}),
  };

  if (format === "csv") {
    const rows = await prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 1000 });
    const csv = toCsv(rows, CSV_COLUMNS);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-log-export.csv"`,
      },
    });
  }

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * take,
      take,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return NextResponse.json({ rows, total, page, take });
}
