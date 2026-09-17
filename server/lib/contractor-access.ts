/**
 * Contractor access - the partner login code and admin activation, in one place.
 *
 * The code a contractor taps at /partner/login is issued by an admin and shown once. It is stored
 * as `sha256:<hex>`, never as the code itself, so nobody reading `handyman_profiles` sees a working
 * code. The login is an equality lookup on that column, so the hash is unsalted: a salted hash could
 * not be found by code. An 8-digit code has too few values for the hash to resist a guess run
 * against a stolen row; it keeps the code out of sight, and the login's per-client lockout
 * (server/contractor-auth.ts) is what limits guessing.
 *
 * Codes stored before hashing are plain text. They still match, and the login rewrites them to the
 * hashed form (`accessCodeNeedsUpgrade`).
 */
import { createHash, randomInt } from 'crypto';

export const ACCESS_CODE_HASH_PREFIX = 'sha256:';

/** Digits only, because /partner/login is a keypad that takes at most 8. */
export const ACCESS_CODE_LENGTH = 8;

export function hashAccessCode(code: string): string {
  return ACCESS_CODE_HASH_PREFIX + createHash('sha256').update(code, 'utf8').digest('hex');
}

export function generateAccessCode(): string {
  let code = '';
  for (let i = 0; i < ACCESS_CODE_LENGTH; i++) code += String(randomInt(10));
  return code;
}

/**
 * The stored values a typed code may match: its hash, and the code itself for a code stored before
 * hashing. A typed value that already looks like a stored hash matches nothing, so a leaked hash
 * cannot be sent in place of the code.
 */
export function storedAccessCodeCandidates(code: string): string[] {
  if (!code || code.startsWith(ACCESS_CODE_HASH_PREFIX)) return [];
  return [hashAccessCode(code), code];
}

/** True when the stored value is a plain-text code that a successful login should rehash. */
export function accessCodeNeedsUpgrade(stored: string | null | undefined): boolean {
  return !!stored && !stored.startsWith(ACCESS_CODE_HASH_PREFIX);
}

/** A contractor is let in only once an admin has activated them. */
export function isActivated(profile: { activatedAt: Date | string | null | undefined }): boolean {
  return profile.activatedAt != null;
}
