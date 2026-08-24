import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { consumeMfaChallenge, decryptMfaSecret, verifyTotpCode } from "@/lib/auth/mfa";
import { finalizeSession } from "@/lib/auth/login-flow";
import { recordAudit } from "@/lib/audit";
import { isRateLimited } from "@/lib/rate-limit";
import { getClientIp, getUserAgent } from "@/lib/request-meta";
import { mfaVerifySchema } from "@/lib/validation";

/**
 * Step 2 of login for MFA-required accounts (SRS §30). Also completes
 * first-time enrollment: if the account's mfaEnabled was still false,
 * a successful code here confirms the secret is correctly loaded into
 * the user's authenticator app and flips it to true.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = mfaVerifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
  }
  const { challengeToken, code } = parsed.data;

  const ipAddress = getClientIp(request);
  const userAgent = getUserAgent(request);

  if (isRateLimited(`auth:mfa:${challengeToken}`, 5)) {
    return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
  }

  const challenge = await consumeMfaChallenge(challengeToken);
  if (!challenge) {
    return NextResponse.json({ error: "This verification session has expired. Sign in again." }, { status: 401 });
  }

  const adminUser = await prisma.adminUser.findUnique({ where: { id: challenge.adminUserId } });
  if (!adminUser || adminUser.status !== "ACTIVE" || !adminUser.mfaSecret) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const codeValid = verifyTotpCode(decryptMfaSecret(adminUser.mfaSecret), code);
  if (!codeValid) {
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "auth.mfa_verify",
      result: "DENIED",
      ipAddress,
    });
    return NextResponse.json({ error: "Incorrect code. Please try again." }, { status: 401 });
  }

  if (!adminUser.mfaEnabled) {
    await prisma.adminUser.update({ where: { id: adminUser.id }, data: { mfaEnabled: true } });
  }

  const { roleNames } = await finalizeSession(adminUser, { ipAddress, userAgent });

  return NextResponse.json({
    status: "success",
    user: { id: adminUser.id, name: adminUser.name, email: adminUser.email, roles: roleNames },
  });
}
