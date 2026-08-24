import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guards";
import { verifyPassword } from "@/lib/auth/password";
import { markSensitiveVerified } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { isRateLimited } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { reauthSchema } from "@/lib/validation";

/**
 * SRS §23: "sensitive-action re-authentication... prompts a
 * re-authentication step (password or MFA re-entry) even within an
 * active session." Password re-entry — the SRS accepts either; this
 * reuses the exact password-verification path login already uses rather
 * than building a parallel one. A successful check here is what
 * requireFreshSensitiveVerification (guards.ts) looks for before
 * allowing a Role & Permission Matrix edit (SCR-050).
 */
export async function POST(request: Request) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const { adminUser, session } = sessionResult.context;

  if (isRateLimited(`auth:reauth:${adminUser.id}`, 5)) {
    return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = reauthSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter your password." }, { status: 400 });
  }

  const ipAddress = getClientIp(request);
  // An authenticated session only ever exists for an ACTIVE account, and
  // the only path to ACTIVE sets passwordHash in the same write — this
  // is just a defensive type-narrow, never expected to actually trigger.
  const passwordValid = adminUser.passwordHash ? await verifyPassword(adminUser.passwordHash, parsed.data.password) : false;

  if (!passwordValid) {
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: "auth.reauth",
      result: "DENIED",
      ipAddress,
      sessionId: session.id,
    });
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  await markSensitiveVerified(session.id);
  await recordAudit({
    actorId: adminUser.id,
    actorEmail: adminUser.email,
    action: "auth.reauth",
    result: "SUCCESS",
    ipAddress,
    sessionId: session.id,
  });

  return NextResponse.json({ status: "success" });
}
