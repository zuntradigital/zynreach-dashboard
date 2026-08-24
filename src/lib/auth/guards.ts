import "server-only";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveSession, isSensitiveVerificationFresh, type ResolvedSession } from "./session";
import { getEffectivePermissions, hasPermission, type EffectivePermissions } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-meta";

export const SESSION_COOKIE_NAME = "zynreach_admin_session";

/**
 * SRS §31: "the API independently rejects and Audit Logs any attempt,
 * protecting against a stale/cached UI state" — every guard below is
 * designed so a route handler CANNOT accidentally skip it (it returns a
 * ready-to-send NextResponse on failure, not a boolean the caller has to
 * remember to check), and every rejection is audited, matching §29:
 * "every successful and rejected mutating call — including
 * permission-denied attempts — writes an AuditLog entry with
 * `result: success|denied|error`."
 */
export type GuardResult<T> = { ok: true; context: T } | { ok: false; response: NextResponse };

export async function getSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value;
}

/** Reads the session cookie and resolves it — 401 if missing/invalid/expired. */
export async function requireSession(): Promise<GuardResult<ResolvedSession>> {
  const rawToken = await getSessionToken();
  if (!rawToken) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }

  const resolved = await resolveSession(rawToken);
  if (!resolved) {
    return { ok: false, response: NextResponse.json({ error: "Session expired." }, { status: 401 }) };
  }

  return { ok: true, context: resolved };
}

export interface AuthorizedContext extends ResolvedSession {
  effective: EffectivePermissions;
}

/**
 * requireSession + a specific module:action permission check (SRS §8),
 * with a denied attempt written to AuditLog before the 403 is returned —
 * this is what makes the enforcement real at the API layer rather than
 * something only the UI happens to respect (§31, §23).
 */
export async function requirePermission(
  request: Request,
  module: string,
  action: string
): Promise<GuardResult<AuthorizedContext>> {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult;

  const { adminUser, session } = sessionResult.context;
  const effective = await getEffectivePermissions(adminUser.id);

  if (!hasPermission(effective, module, action)) {
    await recordAudit({
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      action: `${module}:${action}`,
      result: "DENIED",
      ipAddress: getClientIp(request),
      sessionId: session.id,
    });
    return { ok: false, response: NextResponse.json({ error: "Permission denied." }, { status: 403 }) };
  }

  return { ok: true, context: { ...sessionResult.context, effective } };
}

/**
 * SRS §23: sensitive actions require re-authentication "regardless of
 * session freshness." Layer this on top of requirePermission for the
 * specific routes that need it (none exist yet in Phase 1's own scope —
 * Pricing/Legal/Security publish are later-phase — but the mechanism is
 * ready for those routes to use without any rearchitecting).
 */
export function requireFreshSensitiveVerification(context: AuthorizedContext): GuardResult<AuthorizedContext> {
  if (!isSensitiveVerificationFresh(context.session)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Re-authentication required for this action." }, { status: 401 }),
    };
  }
  return { ok: true, context };
}

/**
 * Service-to-service auth (SRS §29: "All System B APIs are authenticated
 * (session or service token)") — for the leads-ingestion endpoint, which
 * zynreach-website's own server-side services call directly, not an
 * interactively-logged-in AdminUser. Constant-time comparison avoids a
 * timing side-channel on the shared secret.
 */
export function requireServiceToken(request: Request): GuardResult<{ tokenIdentity: string }> {
  const configuredToken = process.env.SERVICE_INGEST_TOKEN;
  const authHeader = request.headers.get("authorization");
  const providedToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (!configuredToken || !providedToken) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }

  const configuredBuf = Buffer.from(configuredToken);
  const providedBuf = Buffer.from(providedToken);
  const matches = configuredBuf.length === providedBuf.length && timingSafeEqual(configuredBuf, providedBuf);

  if (!matches) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }

  return { ok: true, context: { tokenIdentity: "website-ingest" } };
}
