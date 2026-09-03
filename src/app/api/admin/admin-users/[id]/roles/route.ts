import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission, requireFreshSensitiveVerification } from "@/lib/auth/guards";
import { invalidateAllSessionsForUser } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { roleAssignmentSchema } from "@/lib/validation";

/**
 * Role assignment for an existing AdminUser (SRS §8: Super Administrator
 * "manages roles, permissions..."). Account creation lives in
 * POST /api/admin/admin-users; status changes (deactivate/reactivate)
 * live in PATCH /api/admin/admin-users/[id].
 *

 * Full-replace semantics: the caller sends the complete desired roleIds
 * set for the target account, not an add/remove delta — matches
 * AdminUser.roleIds[] (§28.2) and keeps the diff/invalidation logic
 * simple and unambiguous.
 */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "rbac", "manage");
  if (!auth.ok) return auth.response;

  const { id: targetAdminUserId } = await context.params;
  const ipAddress = getClientIp(request);

  if (targetAdminUserId === auth.context.adminUser.id) {
    return NextResponse.json(
      { error: "Cannot modify your own role assignments." },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = roleAssignmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide a valid list of role IDs." }, { status: 400 });
  }

  const targetUser = await prisma.adminUser.findUnique({
    where: { id: targetAdminUserId },
    select: { roles: { select: { roleId: true } } },
  });
  if (!targetUser) {
    return NextResponse.json({ error: "Admin user not found." }, { status: 404 });
  }

  const nextRoleIds = Array.from(new Set(parsed.data.roleIds)).sort();
  const validRoles = await prisma.role.findMany({ where: { id: { in: nextRoleIds } } });
  if (validRoles.length !== nextRoleIds.length) {
    return NextResponse.json({ error: "One or more role IDs do not exist." }, { status: 400 });
  }

  // Assigning Super Administrator requires fresh re-authentication, same
  // requireFreshSensitiveVerification gate the Role & Permission Matrix
  // Editor already uses — a normal active session is not enough by
  // itself for this highest-privilege action.
  if (validRoles.some((role) => role.name === "Super Administrator")) {
    const reauth = requireFreshSensitiveVerification(auth.context);
    if (!reauth.ok) return reauth.response;
  }

  const currentRoleIds = targetUser.roles.map((r) => r.roleId).sort();
  const changed =
    currentRoleIds.length !== nextRoleIds.length ||
    currentRoleIds.some((id, index) => id !== nextRoleIds[index]);

  if (changed) {
    await prisma.$transaction([
      prisma.adminUserRole.deleteMany({ where: { adminUserId: targetAdminUserId } }),
      ...(nextRoleIds.length > 0
        ? [
            prisma.adminUserRole.createMany({
              data: nextRoleIds.map((roleId) => ({ adminUserId: targetAdminUserId, roleId })),
            }),
          ]
        : []),
    ]);

    // The actual enforcement point for SRS §30's "session invalidation on
    // role/permission change" — every existing session for this account
    // is deleted so the next request must re-authenticate under the new
    // effective permission set.
    await invalidateAllSessionsForUser(targetAdminUserId);

    await recordAudit({
      actorId: auth.context.adminUser.id,
      actorEmail: auth.context.adminUser.email,
      action: "admin_user.roles_update",
      resourceType: "AdminUser",
      resourceId: targetAdminUserId,
      before: { roleIds: currentRoleIds },
      after: { roleIds: nextRoleIds },
      result: "SUCCESS",
      ipAddress,
      sessionId: auth.context.session.id,
    });
  }

  return NextResponse.json({
    status: "success",
    roleIds: nextRoleIds,
    roleNames: validRoles.map((role) => role.name),
    sessionsInvalidated: changed,
  });
}
