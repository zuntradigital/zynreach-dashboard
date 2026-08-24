import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { previewInvitation, resolveInvitationForCompletion } from "@/lib/auth/invitations";
import { resolvePostPasswordAuth } from "@/lib/auth/login-flow";
import { recordAudit } from "@/lib/audit";
import { isRateLimited } from "@/lib/rate-limit";
import { getClientIp, getUserAgent } from "@/lib/request-meta";
import { acceptInvitationSchema } from "@/lib/validation";

/**
 * Unauthenticated, non-consuming — the accept-invite page calls this on
 * load to show "you've been invited as {name} ({email})". Never mutates
 * the invitation (see AdminUserInvitation's schema comment for why a
 * page view must not advance its state). `alreadyAccepted` tells the
 * page whether to show the "Accept Invitation" step or skip straight to
 * the password form (e.g. on a reload after accepting).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing invitation token." }, { status: 400 });
  }

  const preview = await previewInvitation(token);
  if (!preview) {
    return NextResponse.json({ error: "This invitation link is invalid or has expired." }, { status: 404 });
  }

  return NextResponse.json({ name: preview.name, email: preview.email, alreadyAccepted: preview.alreadyAccepted });
}

/**
 * Step 3 (password setup completed → Active): requires the invitation to
 * have already been through the separate "Accept Invitation" step
 * (resolveInvitationForCompletion enforces this — see
 * lib/auth/invitations.ts for the full four-state lifecycle). Sets the
 * invited person's own first password and activates the account; the
 * PENDING-only precondition on lookup is what makes this single-use —
 * once status flips to ACTIVE, this token can never complete again.
 * Then hands off to the exact same post-password branch login uses
 * (resolvePostPasswordAuth), so a role requiring MFA (§30) still enrolls
 * it here rather than skipping straight to a session.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = acceptInvitationSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const issue = fieldErrors.name?.[0] || fieldErrors.password?.[0];
    return NextResponse.json({ error: issue || "Enter a valid invitation, name, and password." }, { status: 400 });
  }
  const { token, name, password } = parsed.data;

  if (isRateLimited(`auth:accept-invite:${token}`, 5)) {
    return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
  }

  const ipAddress = getClientIp(request);
  const userAgent = getUserAgent(request);

  const resolved = await resolveInvitationForCompletion(token);
  if (!resolved) {
    return NextResponse.json({ error: "This invitation link is invalid or has expired." }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  const adminUser = await prisma.adminUser.update({
    where: { id: resolved.adminUserId },
    data: { name, passwordHash, status: "ACTIVE" },
  });

  await recordAudit({
    actorId: adminUser.id,
    actorEmail: adminUser.email,
    action: "admin_user.invite_setup_completed",
    resourceType: "AdminUser",
    resourceId: adminUser.id,
    before: { status: "PENDING" },
    after: { status: "ACTIVE" },
    result: "SUCCESS",
    ipAddress,
  });

  const result = await resolvePostPasswordAuth(adminUser, { ipAddress, userAgent });

  if (result.kind === "mfa_setup_required") {
    return NextResponse.json({
      status: "mfa_setup_required",
      challengeToken: result.challengeToken,
      qrCodeDataUrl: result.qrCodeDataUrl,
      secret: result.secret,
    });
  }

  if (result.kind === "mfa_required") {
    // Not reachable on a brand-new account (MFA is never pre-enrolled
    // before first login), kept only so this stays a complete mirror of
    // login's branching rather than a silently narrower copy of it.
    return NextResponse.json({ status: "mfa_required", challengeToken: result.challengeToken });
  }

  return NextResponse.json({
    status: "success",
    user: { id: adminUser.id, name: adminUser.name, email: adminUser.email, roles: result.roleNames },
  });
}
