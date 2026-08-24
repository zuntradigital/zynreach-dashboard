import argon2 from "argon2";

/**
 * argon2id — current OWASP-recommended default for password storage
 * (the "Database" section of the architecture plan; SRS §30 requires
 * secure password storage in principle but names no specific algorithm,
 * so this choice is an implementation detail, not an SRS requirement).
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  return argon2.hash(plainPassword, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plainPassword: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plainPassword);
  } catch {
    // A malformed/foreign hash format throws rather than returning false —
    // treat that identically to "wrong password" rather than letting it
    // surface as a 500, since either way the credential check must fail.
    return false;
  }
}
