import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { resolvePostPasswordAuth } from "@/lib/auth/login-flow";
import { recordAudit } from "@/lib/audit";
import { isRateLimited } from "@/lib/rate-limit";
import { getClientIp, getUserAgent } from "@/lib/request-meta";
import { loginSchema } from "@/lib/validation";

/**
 * Step 1 of login: verify email + password.
 *  - No matching role requires MFA → session issued immediately.
 *  - A held role requires MFA (SRS §30) and it's not yet enrolled →
 *    "mfa_setup_required" with a QR enrollment code; verifying the
 *    first code both completes enrollment and completes login.
 *  - Already enrolled → "mfa_required"; the client must call
 *    /api/admin/auth/mfa-verify next. No session exists until then.
 *
 * Rate-limited per submitted email (SRS §30 "per-account"), not per IP —
 * this is specifically about protecting one account from being
 * hammered, independent of how many different IPs an attacker uses.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  }
  const { email, password } = parsed.data;

  if (isRateLimited(`auth:login:${email}`, 5)) {
    return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
  }

  const ipAddress = getClientIp(request);
  const userAgent = getUserAgent(request);

  let adminUser;
  try {
    adminUser = await prisma.adminUser.findUnique({ where: { email } });
  } catch (err) {
    // TEMPORARY diagnostic — logs only shape/metadata about DATABASE_URL
    // as this specific running process sees it (never the value itself),
    // to distinguish "not set", "wrong protocol", and "extra
    // quotes/whitespace" without exposing credentials in server logs.
    // Remove once the production DATABASE_URL issue is confirmed fixed.
    const raw = process.env.DATABASE_URL;
    console.error("[login] prisma.adminUser.findUnique threw:", err instanceof Error ? err.message : err);
    console.error("[login] DATABASE_URL diagnostic:", {
      isSet: raw !== undefined,
      length: raw?.length ?? 0,
      startsWithMysqlProtocol: raw?.startsWith("mysql://") ?? false,
      hasLeadingOrTrailingWhitespace: raw !== undefined && raw !== raw.trim(),
      isWrappedInQuotes: raw !== undefined && /^['"].*['"]$/.test(raw),
      first10Chars: raw?.slice(0, 10) ?? null,
    });

    // TEMPORARY diagnostic — attempts a raw connection with the driver
    // Prisma's own query engine wraps, bypassing Prisma's error
    // normalization entirely, to see exactly what MySQL itself reports:
    // which account/host it matched (or the raw driver error code, e.g.
    // ER_ACCESS_DENIED_ERROR/1045 vs ER_HOST_NOT_PRIVILEGED/1130) for
    // this specific connection attempt. Never logs the password. Remove
    // once the production MySQL access issue is confirmed fixed.
    if (raw) {
      try {
        const connection = await mysql.createConnection(raw);
        const [rows] = await connection.query("SELECT USER() AS user, CURRENT_USER() AS currentUser, @@hostname AS serverHostname");
        console.error("[login] raw mysql2 connection SUCCEEDED:", rows);
        await connection.end();
      } catch (rawErr) {
        const e = rawErr as { code?: string; errno?: number; message?: string };
        console.error("[login] raw mysql2 connection FAILED:", { code: e.code, errno: e.errno, message: e.message });
      }
    }

    throw err;
  }

  // Generic failure response for every rejection path below — never
  // reveal whether the email exists, the password was wrong, or the
  // account is inactive, to an unauthenticated caller.
  const genericFailure = () =>
    NextResponse.json({ error: "Invalid email or password." }, { status: 401 });

  // status !== "ACTIVE" also covers PENDING (invited, not yet accepted —
  // passwordHash is null for those accounts) and DEACTIVATED, so
  // verifyPassword below is never reached without a real hash to compare.
  if (!adminUser || adminUser.status !== "ACTIVE" || !adminUser.passwordHash) {
    await recordAudit({
      actorEmail: email,
      action: "auth.login",
      result: "DENIED",
      ipAddress,
    });
    return genericFailure();
  }

  const passwordValid = await verifyPassword(adminUser.passwordHash, password);
  if (!passwordValid) {
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "auth.login",
      result: "DENIED",
      ipAddress,
    });
    return genericFailure();
  }

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
    return NextResponse.json({ status: "mfa_required", challengeToken: result.challengeToken });
  }

  return NextResponse.json({
    status: "success",
    user: { id: adminUser.id, name: adminUser.name, email: adminUser.email, roles: result.roleNames },
  });
}
