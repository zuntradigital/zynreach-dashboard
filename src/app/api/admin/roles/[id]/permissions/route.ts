import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission, requireFreshSensitiveVerification } from "@/lib/auth/guards";
import { invalidateAllSessionsForRole } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { rolePermissionsSchema } from "@/lib/validation";

/**
 * SCR-050 — Role & Permission Matrix Editor. SRS §23: "Module × Action
 * permission matrix... editable by Super Administrator via the Role &
 * Permission Matrix Editor (SCR-050); every checkbox change is Audit
 * Logged" and "any change in the Role & Permission Matrix prompts a
 * re-authentication step... even within an active session" (FR-ADM-001)
 * — hence requireFreshSensitiveVerification on top of the usual
 * rbac:manage permission check, layered exactly as guards.ts's own doc
 * comment anticipated when it was built in Phase 1.
 *
 * Full-replace semantics, same shape as the AdminUser roles endpoint.
 */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "rbac", "manage");
  if (!auth.ok) return auth.response;

  const reauth = requireFreshSensitiveVerification(auth.context);
  if (!reauth.ok) return reauth.response;

  const { id: roleId } = await context.params;
  const ipAddress = getClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = rolePermissionsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide a valid list of permission IDs." }, { status: 400 });
  }

  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: { permissions: true },
  });
  if (!role) {
    return NextResponse.json({ error: "Role not found." }, { status: 404 });
  }

  const nextPermissionIds = Array.from(new Set(parsed.data.permissionIds)).sort();
  const validPermissions = await prisma.permission.findMany({ where: { id: { in: nextPermissionIds } } });
  if (validPermissions.length !== nextPermissionIds.length) {
    return NextResponse.json({ error: "One or more permission IDs do not exist." }, { status: 400 });
  }

  // Self-lockout guard, same principle as the AdminUser role-assignment
  // endpoint's own guard: removing rbac:manage from Super Administrator
  // would leave no account able to reach this screen (or the Users
  // screen) again through the UI.
  if (role.name === "Super Administrator") {
    const rbacManage = await prisma.permission.findUnique({
      where: { module_action: { module: "rbac", action: "manage" } },
    });
    if (rbacManage && !nextPermissionIds.includes(rbacManage.id)) {
      return NextResponse.json(
        { error: "Cannot remove rbac:manage from the Super Administrator role." },
        { status: 400 }
      );
    }
  }

  const currentPermissionIds = role.permissions.map((rp) => rp.permissionId).sort();
  const changed =
    currentPermissionIds.length !== nextPermissionIds.length ||
    currentPermissionIds.some((id, index) => id !== nextPermissionIds[index]);

  if (changed) {
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId } }),
      ...(nextPermissionIds.length > 0
        ? [
            prisma.rolePermission.createMany({
              data: nextPermissionIds.map((permissionId) => ({ roleId, permissionId })),
            }),
          ]
        : []),
    ]);

    // The enforcement point for §30's session invalidation extended to
    // every account holding this role, not just the acting admin.
    await invalidateAllSessionsForRole(roleId);

    // Human-readable module:action diff, so the audit trail is legible
    // without cross-referencing permission IDs (§17 of the RBAC directive:
    // "which module... which permission... previous/new state").
    const currentSet = new Set(currentPermissionIds);
    const nextSet = new Set(nextPermissionIds);
    const touchedIds = [...new Set([...currentPermissionIds, ...nextPermissionIds])].filter(
      (id) => currentSet.has(id) !== nextSet.has(id)
    );
    const touchedPermissions = await prisma.permission.findMany({ where: { id: { in: touchedIds } } });
    const labelById = new Map(touchedPermissions.map((p) => [p.id, `${p.module}:${p.action}`]));
    const added = touchedIds.filter((id) => nextSet.has(id) && !currentSet.has(id)).map((id) => labelById.get(id) ?? id).sort();
    const removed = touchedIds.filter((id) => currentSet.has(id) && !nextSet.has(id)).map((id) => labelById.get(id) ?? id).sort();

    await recordAudit({
      actorId: auth.context.adminUser.id,
      actorEmail: auth.context.adminUser.email,
      action: "role.permissions_update",
      resourceType: "Role",
      resourceId: roleId,
      before: { permissionIds: currentPermissionIds },
      after: { permissionIds: nextPermissionIds, roleName: role.name, added, removed },
      result: "SUCCESS",
      ipAddress,
      sessionId: auth.context.session.id,
    });
  }

  return NextResponse.json({
    status: "success",
    permissionIds: nextPermissionIds,
    sessionsInvalidated: changed,
  });
}
