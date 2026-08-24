import type { AdminUser } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createSession } from "./session";
import { setSessionCookie } from "./cookies";
import { getEffectivePermissions } from "@/lib/rbac";
import { createMfaChallenge, decryptMfaSecret, encryptMfaSecret, generateMfaSecret, getMfaEnrollmentQrCode } from "./mfa";
import { recordAudit } from "@/lib/audit";
import { isMfaBypassedForDev } from "./dev-mfa-bypass";

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

async function issueSessionAndAudit(adminUser: AdminUser, context: RequestContext): Promise<void> {
  const { rawToken, session } = await createSession({
    adminUserId: adminUser.id,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
  await setSessionCookie(rawToken, session.expiresAt);
  await prisma.adminUser.update({ where: { id: adminUser.id }, data: { lastLoginAt: new Date() } });
  await recordAudit({
    actorId: adminUser.id,
    actorEmail: adminUser.email,
    action: "auth.login",
    result: "SUCCESS",
    ipAddress: context.ipAddress,
    sessionId: session.id,
  });
}

/** Used only where an MFA challenge has *already* been resolved
 * (mfa-verify's success path) — no MFA-required branch to re-check. */
export async function finalizeSession(adminUser: AdminUser, context: RequestContext): Promise<{ roleNames: string[] }> {
  const effective = await getEffectivePermissions(adminUser.id);
  await issueSessionAndAudit(adminUser, context);
  return { roleNames: effective.roleNames };
}

export type PostPasswordAuthResult =
  | { kind: "mfa_setup_required"; challengeToken: string; qrCodeDataUrl: string; secret: string }
  | { kind: "mfa_required"; challengeToken: string }
  | { kind: "session"; roleNames: string[] };

/**
 * The exact "what happens right after a password check succeeds" branch
 * — shared by login (after verifyPassword) and accept-invite (after the
 * invited user sets their first password): does this account's effective
 * role set require MFA (SRS §30)? If enrollment was never completed,
 * return enrollment material; if already enrolled, require a fresh code;
 * otherwise issue the session immediately. Extracted so accept-invite
 * can't silently skip MFA enrollment for a role that requires it — it
 * goes through the identical gate login always has.
 */
export async function resolvePostPasswordAuth(adminUser: AdminUser, context: RequestContext): Promise<PostPasswordAuthResult> {
  const effective = await getEffectivePermissions(adminUser.id);

  if (effective.mfaRequired && !isMfaBypassedForDev()) {
    // mfaSecret is encrypted at rest (mfa.ts) — decrypt on read (a no-op
    // for legacy secrets stored before encryption was added), encrypt on
    // write, so enrollment/re-enrollment always work with the plaintext
    // TOTP secret in memory only.
    let secret = adminUser.mfaSecret ? decryptMfaSecret(adminUser.mfaSecret) : adminUser.mfaSecret;
    const needsEnrollment = !adminUser.mfaEnabled;

    if (needsEnrollment && !secret) {
      secret = generateMfaSecret();
      await prisma.adminUser.update({ where: { id: adminUser.id }, data: { mfaSecret: encryptMfaSecret(secret) } });
    }

    const { rawToken } = await createMfaChallenge(adminUser.id, context.ipAddress);

    if (needsEnrollment && secret) {
      const qrCodeDataUrl = await getMfaEnrollmentQrCode(adminUser.email, secret);
      return { kind: "mfa_setup_required", challengeToken: rawToken, qrCodeDataUrl, secret };
    }

    return { kind: "mfa_required", challengeToken: rawToken };
  }

  await issueSessionAndAudit(adminUser, context);
  return { kind: "session", roleNames: effective.roleNames };
}
