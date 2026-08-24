import { prisma } from "@/lib/db";
import { generateToken, hashToken } from "./tokens";
import type { AdminUser, Session } from "@prisma/client";

/** SRS §30: "session timeout after 30 minutes of inactivity." */
export const SESSION_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

/** Hard ceiling independent of activity — a reasonable implementation
 * default (not an SRS-specified number); a session cannot be kept alive
 * by activity alone forever. */
const SESSION_ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * SRS §23: "sensitive-action re-authentication... prompts a
 * re-authentication step... even within an active session." The SRS
 * does not specify a grace window after that re-verification before it's
 * required again; 5 minutes is an implementation decision (a "sudo
 * mode"-style window), not an SRS requirement, chosen to avoid
 * re-prompting on every single click of a multi-step sensitive action.
 */
export const SENSITIVE_REAUTH_GRACE_MS = 5 * 60 * 1000;

export interface CreateSessionOptions {
  adminUserId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface CreatedSession {
  rawToken: string;
  session: Session;
}

export async function createSession({ adminUserId, ipAddress, userAgent }: CreateSessionOptions): Promise<CreatedSession> {
  const rawToken = generateToken();
  const now = new Date();
  const session = await prisma.session.create({
    data: {
      tokenHash: hashToken(rawToken),
      adminUserId,
      ipAddress,
      userAgent,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS),
    },
  });
  return { rawToken, session };
}

export interface ResolvedSession {
  session: Session;
  adminUser: AdminUser;
}

/**
 * Validates a raw session token: exists, not past its absolute
 * expiry, and not idle beyond the 30-minute inactivity window (SRS
 * §30). A stale-but-not-yet-absolutely-expired session is treated as
 * invalid and deleted here, exactly like an explicit logout — inactivity
 * timeout is a real session termination, not merely a warning.
 * On success, the session's activity clock is reset (sliding window).
 */
export async function resolveSession(rawToken: string): Promise<ResolvedSession | null> {
  const tokenHash = hashToken(rawToken);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { adminUser: true },
  });
  if (!session) return null;

  const now = Date.now();
  const idleFor = now - session.lastActivityAt.getTime();
  const expired = now > session.expiresAt.getTime() || idleFor > SESSION_INACTIVITY_TIMEOUT_MS;

  if (expired) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  if (session.adminUser.status !== "ACTIVE") {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  const touched = await prisma.session.update({
    where: { id: session.id },
    data: { lastActivityAt: new Date(now) },
  });

  return { session: touched, adminUser: session.adminUser };
}

export async function invalidateSession(sessionId: string): Promise<void> {
  await prisma.session.delete({ where: { id: sessionId } }).catch(() => undefined);
}

/**
 * SRS §30: "session invalidation on role/permission change for the
 * affected account." Deleting every session row for the user is what
 * database-backed sessions buy over JWTs here — there is no revocation
 * list to separately maintain.
 */
export async function invalidateAllSessionsForUser(adminUserId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { adminUserId } });
}

/**
 * Same §30 requirement, cascaded: a Role & Permission Matrix edit
 * (SCR-050) changes what a role grants, which affects every account
 * holding that role, not just one — so every one of their sessions is
 * invalidated, not just the acting Super Administrator's.
 */
export async function invalidateAllSessionsForRole(roleId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { adminUser: { roles: { some: { roleId } } } } });
}

/** Marks the current session as having just passed a sensitive-action
 * re-authentication check (SRS §23). */
export async function markSensitiveVerified(sessionId: string): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { sensitiveVerifiedAt: new Date() },
  });
}

export function isSensitiveVerificationFresh(session: Session): boolean {
  if (!session.sensitiveVerifiedAt) return false;
  return Date.now() - session.sensitiveVerifiedAt.getTime() <= SENSITIVE_REAUTH_GRACE_MS;
}
