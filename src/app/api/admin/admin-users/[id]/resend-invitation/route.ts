import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { createInvitation, invalidateInvitationsForUser } from "@/lib/auth/invitations";
import { sendInvitationEmail } from "@/lib/email/send";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";

function buildInviteUrl(rawToken: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  return `${base}/en/accept-invite?token=${rawToken}`;
}

/**
 * Resends an invitation — only meaningful for a still-PENDING account
 * (one that never completed accept-invite). Invalidates any prior
 * unaccepted invitation for this user first, so an older emailed link
 * stops working the moment a new one is issued, matching how every real
 * invite system behaves.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, "rbac", "manage");
  if (!auth.ok) return auth.response;

  const { id: targetAdminUserId } = await context.params;
  const ipAddress = getClientIp(request);

  const targetUser = await prisma.adminUser.findUnique({ where: { id: targetAdminUserId } });
  if (!targetUser) {
    return NextResponse.json({ error: "Admin user not found." }, { status: 404 });
  }
  if (targetUser.status !== "PENDING") {
    return NextResponse.json({ error: "This account has already been activated." }, { status: 400 });
  }

  await invalidateInvitationsForUser(targetAdminUserId);
  const { rawToken, expiresAt } = await createInvitation(targetAdminUserId);
  const inviteUrl = buildInviteUrl(rawToken);
  const emailResult = await sendInvitationEmail({ to: targetUser.email, inviteUrl, expiresAt });

  await recordAudit({
    actorId: auth.context.adminUser.id,
    actorEmail: auth.context.adminUser.email,
    action: "admin_user.invite_resend",
    resourceType: "AdminUser",
    resourceId: targetAdminUserId,
    after: { email: targetUser.email, emailSent: emailResult.sent },
    result: "SUCCESS",
    ipAddress,
    sessionId: auth.context.session.id,
  });

  return NextResponse.json({
    status: "success",
    invitation: { inviteUrl, expiresAt, emailSent: emailResult.sent, emailError: emailResult.reason ?? null },
  });
}
