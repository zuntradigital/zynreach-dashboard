import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";

/** Backs the permission-matrix columns on SCR-050. Same rbac:manage gate
 * as the rest of the RBAC-admin surface. */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "rbac", "manage");
  if (!auth.ok) return auth.response;

  const permissions = await prisma.permission.findMany({
    orderBy: [{ module: "asc" }, { action: "asc" }],
    select: { id: true, module: true, action: true },
  });

  return NextResponse.json({ permissions });
}
