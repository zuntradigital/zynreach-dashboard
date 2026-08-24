import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { invalidateAllSessionsForUser } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";
import { updateAdminUserStatusSchema } from "@/lib/validation";

/**
 * FR-ADM-020's "deactivate accounts" — this endpoint only ever flips
 * AdminUser.status (soft, reversible, audit history untouched). Real
 * deletion is a separate, permanent action — see DELETE below.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "rbac", "manage");
  if (!auth.ok) return auth.response;

  const { id: targetAdminUserId } = await context.params;
  const ipAddress = getClientIp(request);

  if (targetAdminUserId === auth.context.adminUser.id) {
    return NextResponse.json({ error: "Cannot change your own account status." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = updateAdminUserStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide a valid status." }, { status: 400 });
  }

  const targetUser = await prisma.adminUser.findUnique({ where: { id: targetAdminUserId } });
  if (!targetUser) {
    return NextResponse.json({ error: "Admin user not found." }, { status: 404 });
  }

  const { status: nextStatus } = parsed.data;
  if (targetUser.status === nextStatus) {
    return NextResponse.json({ status: "success", accountStatus: targetUser.status, sessionsInvalidated: false });
  }

  await prisma.adminUser.update({ where: { id: targetAdminUserId }, data: { status: nextStatus } });

  let sessionsInvalidated = false;
  if (nextStatus === "DEACTIVATED") {
    // resolveSession (session.ts) also re-checks status on every request,
    // but invalidating here means the account is locked out immediately
    // rather than only at its next natural session-touch.
    await invalidateAllSessionsForUser(targetAdminUserId);
    sessionsInvalidated = true;
  }

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "admin_user.status_update",
    resourceType: "AdminUser",
    resourceId: targetAdminUserId,
    before: { status: targetUser.status },
    after: { status: nextStatus },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", accountStatus: nextStatus, sessionsInvalidated });
}

/**
 * "Delete User" — a real, permanent hard delete, always. Every FK on
 * AdminUser across the schema is either Cascade (Session, MfaChallenge,
 * AdminUserRole, AdminUserInvitation — rows that only make sense
 * attached to this user) or SetNull (AuditLog.actorId and every
 * createdByUserId/publishedByUserId/submittedByUserId/etc. across
 * Pages/Pricing/Blog/Resources/Careers/etc.), so `prisma.adminUser.delete`
 * never hits a foreign-key error. AuditLog rows in particular stay
 * meaningful after the row is gone because `actorEmail` is denormalized
 * onto every row independently of `actorId` — the audit trail keeps its
 * historical attribution even once the account itself no longer exists.
 * The only two blocks are unrelated safety rules, not audit history:
 * an admin can't delete their own account, and the last remaining
 * Super Administrator can't be deleted (would lock everyone out of RBAC
 * management).
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "rbac", "manage");
  if (!auth.ok) return auth.response;

  const { id: targetAdminUserId } = await context.params;
  const ipAddress = getClientIp(request);

  if (targetAdminUserId === auth.context.adminUser.id) {
    return NextResponse.json({ error: "Cannot delete your own account." }, { status: 400 });
  }

  const targetUser = await prisma.adminUser.findUnique({
    where: { id: targetAdminUserId },
    include: { roles: { include: { role: true } } },
  });
  if (!targetUser) {
    return NextResponse.json({ error: "Admin user not found." }, { status: 404 });
  }

  const holdsSuperAdmin = targetUser.roles.some((r) => r.role.name === "Super Administrator");
  if (holdsSuperAdmin) {
    const otherSuperAdmins = await prisma.adminUserRole.count({
      where: { role: { name: "Super Administrator" }, adminUserId: { not: targetAdminUserId } },
    });
    if (otherSuperAdmins === 0) {
      return NextResponse.json({ error: "Cannot delete the last Super Administrator account." }, { status: 409 });
    }
  }

  await prisma.adminUser.delete({ where: { id: targetAdminUserId } });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "admin_user.delete",
    resourceType: "AdminUser",
    resourceId: targetAdminUserId,
    before: { name: targetUser.name, email: targetUser.email, status: targetUser.status },
    after: { mode: "deleted" },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({ status: "success", mode: "deleted" });
}
