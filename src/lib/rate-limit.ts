/**
 * Per-account sliding-window rate limiting (SRS §30: "Applied per-account
 * on write endpoints to contain the blast radius of a compromised or
 * malfunctioning session" — distinct from a per-IP limiter, which is why
 * this is keyed by account/service identity, not request IP).
 *
 * In-memory implementation — correct for a single Node.js instance, same
 * documented limitation as zynreach-website's own rate-limit.ts. A
 * multi-instance production deployment needs a shared store
 * (Redis/Upstash); swapping this module's internals for a shared-store
 * client is the only change needed once that infrastructure exists — no
 * caller needs to change.
 */

const WINDOW_MS = 60_000;

const hits = new Map<string, number[]>();

export function isRateLimited(key: string, maxRequestsPerWindow: number): boolean {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const existing = (hits.get(key) ?? []).filter((timestamp) => timestamp > windowStart);

  if (existing.length >= maxRequestsPerWindow) {
    hits.set(key, existing);
    return true;
  }

  existing.push(now);
  hits.set(key, existing);
  return false;
}
