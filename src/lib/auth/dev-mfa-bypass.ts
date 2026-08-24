/**
 * Temporary development-only MFA bypass so a Super Administrator/Publisher
 * account can be exercised with just email + password while manually
 * testing the Dashboard locally. Does not touch the MFA implementation
 * itself (mfa.ts, MfaChallenge model, mfaSecret/mfaEnabled fields) — it
 * only short-circuits the branch in the login route that would otherwise
 * route into it, so re-enabling SRS §30's MFA requirement later is a
 * one-line revert (delete this file's guard from login/route.ts) plus
 * removing the env var, not a re-implementation.
 *
 * Double-gated so this can never silently activate outside local dev:
 * requires NODE_ENV !== "production" AND an explicit opt-in env var.
 */
export function isMfaBypassedForDev(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.DEV_DISABLE_MFA === "true";
}
