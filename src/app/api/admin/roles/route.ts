import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";

/**
 * Backs both the role picker on the Users page (SCR-049) and the row
 * set on the Role & Permission Matrix Editor (SCR-050) — permissionIds
 * is additive to what SCR-049 already consumed, not a breaking change.
 */
export async function GET(request: Request) {
  const auth = await requirePermission(request, "rbac", "manage");
  if (!auth.ok) return auth.response;

  const roles = await prisma.role.findMany({
    orderBy: { name: "asc" },
    include: { permissions: { select: { permissionId: true } } },
  });

  return NextResponse.json({
    roles: roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      mfaRequired: role.mfaRequired,
      permissionIds: role.permissions.map((rp) => rp.permissionId),
    })),
  });
}
