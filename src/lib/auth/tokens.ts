import { randomBytes, createHash } from "node:crypto";

/**
 * Shared primitive for every bearer-token-in-a-cookie pattern in this
 * app (Session, MfaChallenge): generate a high-entropy random value,
 * hand the raw value to the client (cookie), store only its hash.
 * A leaked database row can never be replayed as a live token this way.
 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
