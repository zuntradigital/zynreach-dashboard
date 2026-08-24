import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";

/**
 * Backs the Reassign Owner control on SCR-035 (Lead Detail). Deliberately
 * its own minimal endpoint, gated by leads:edit rather than rbac:manage —
 * Sales Operations holds leads:edit by default but never rbac:manage
 * (Users & Roles, §23), so reusing GET /api/admin/admin-users here would
 * either require widening that endpoint's own permission gate (weakening
 * it) or leave Reassign Owner permanently broken for the one role this
 * capability actually exists for. Returns only the minimal fields a
 * reassignment picker needs — never role/status/audit data.
 */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "leads", "edit");
  if (!auth.ok) return auth.response;

  const owners = await prisma.adminUser.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });

  return NextResponse.json({ owners });
}
