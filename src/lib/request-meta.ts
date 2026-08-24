import { createHmac } from "node:crypto";

/** Shared IP/User-Agent extraction — used by both rate limiting and
 * AuditLog's IP/session metadata fields (SRS §25). */
export function getClientIp(request: Request): string | undefined {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || undefined;
}

export function getUserAgent(request: Request): string | undefined {
  return request.headers.get("user-agent") ?? undefined;
}

/**
 * Keyed hash for Submission.ipHash (SRS §28.2's own field name — the SRS
 * itself specifies storing a hash, not the raw IP, a privacy-conscious
 * choice this implementation is following, not introducing). HMAC keyed
 * with SESSION_SECRET rather than a plain hash, so the value can't be
 * trivially reversed via a rainbow table of common IPs.
 */
export function hashIp(ip: string): string {
  const key = process.env.SESSION_SECRET ?? "";
  return createHmac("sha256", key).update(ip).digest("hex");
}
