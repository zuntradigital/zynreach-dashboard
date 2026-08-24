import { authenticator } from "otplib";
import QRCode from "qrcode";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { generateToken, hashToken } from "./tokens";

const ISSUER = "ZynReach Admin";

/**
 * otplib's authenticator defaults to `window: 0` — it accepts only the
 * exact current 30s time step and rejects everything else, with zero
 * tolerance. That's tighter than the code's own step size affords: any
 * normal clock drift between the phone and this server, or the few
 * seconds it legitimately takes to read a code off Google Authenticator
 * and type it in, pushes the request past the boundary and rejects an
 * otherwise-correct code. RFC 6238 §5.2 recommends allowing a bounded
 * window around the current step for exactly this reason; `window: 1`
 * accepts the previous, current, and next 30s step (a ±30s tolerance),
 * which is the standard balance used by mainstream TOTP implementations
 * — enough to absorb real-world drift/typing delay without materially
 * widening the code's replay window.
 */
authenticator.options = { window: 1 };

/**
 * AdminUser.mfaSecret encryption at rest (AES-256-GCM, MFA_SECRET_ENCRYPTION_KEY).
 * `ENCRYPTED_PREFIX` distinguishes newly-encrypted values from secrets
 * written before this was added — those are legacy plaintext and are
 * returned as-is by decryptMfaSecret() rather than failing, so an
 * already-enrolled account keeps working without forced re-enrollment.
 */
const ENCRYPTED_PREFIX = "enc1:";
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getMfaEncryptionKey(): Buffer {
  const raw = process.env.MFA_SECRET_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("MFA_SECRET_ENCRYPTION_KEY is not configured — cannot encrypt or decrypt MFA secrets.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("MFA_SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes — generate one with `openssl rand -base64 32`.");
  }
  return key;
}

/** Encrypts a TOTP secret before it's written to AdminUser.mfaSecret. Throws (deliberately, not silently) if the key is missing/invalid — a new secret must never be stored unencrypted. */
export function encryptMfaSecret(plaintext: string): string {
  const key = getMfaEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ENCRYPTED_PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/** Decrypts a value read from AdminUser.mfaSecret. A value without ENCRYPTED_PREFIX predates encryption and is returned unchanged. */
export function decryptMfaSecret(stored: string): string {
  if (!stored.startsWith(ENCRYPTED_PREFIX)) {
    return stored;
  }
  const key = getMfaEncryptionKey();
  const raw = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** SRS §30: MFA for Super Administrator and Publisher. No external MFA
 * provider is required — TOTP works with any authenticator app the
 * account holder already has (Google Authenticator, Authy, 1Password,
 * etc.), so there is no new vendor/account to provision for this. */
export function generateMfaSecret(): string {
  return authenticator.generateSecret();
}

export function getMfaEnrollmentUri(email: string, secret: string): string {
  return authenticator.keyuri(email, ISSUER, secret);
}

export async function getMfaEnrollmentQrCode(email: string, secret: string): Promise<string> {
  const uri = getMfaEnrollmentUri(email, secret);
  return QRCode.toDataURL(uri);
}

export function verifyTotpCode(secret: string, code: string): boolean {
  try {
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}

const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface CreatedMfaChallenge {
  rawToken: string;
  challengeId: string;
}

/**
 * Bridges "password verified" to "session issued" for MFA-required
 * accounts (see MfaChallenge in schema.prisma for why this is a DB
 * record rather than a signed client token).
 */
export async function createMfaChallenge(adminUserId: string, ipAddress?: string): Promise<CreatedMfaChallenge> {
  const rawToken = generateToken();
  const challenge = await prisma.mfaChallenge.create({
    data: {
      tokenHash: hashToken(rawToken),
      adminUserId,
      ipAddress,
      expiresAt: new Date(Date.now() + MFA_CHALLENGE_TTL_MS),
    },
  });
  return { rawToken, challengeId: challenge.id };
}

export interface ResolvedMfaChallenge {
  adminUserId: string;
}

/** Consumes (deletes) the challenge on lookup — single-use, whether or
 * not the subsequent code check succeeds, so a leaked challenge token
 * can't be retried indefinitely. */
export async function consumeMfaChallenge(rawToken: string): Promise<ResolvedMfaChallenge | null> {
  const tokenHash = hashToken(rawToken);
  const challenge = await prisma.mfaChallenge.findUnique({ where: { tokenHash } });
  if (!challenge) return null;

  await prisma.mfaChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);

  if (Date.now() > challenge.expiresAt.getTime()) return null;
  return { adminUserId: challenge.adminUserId };
}
