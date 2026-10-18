import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

// Crockford base32 tanpa I, L, O, U agar kode klaim mudah dibaca dari label.
const CLAIM_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export const HW_UID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export function generateDeviceSecret() {
  return randomBytes(24).toString('base64url');
}

export function generateClaimCode() {
  return Array.from({ length: 8 }, () => CLAIM_ALPHABET[randomInt(CLAIM_ALPHABET.length)]).join('');
}

/** "k7q2-m9xd" → "K7Q2M9XD" (spasi/strip diabaikan). */
export function normalizeClaimCode(code) {
  return String(code || '').toUpperCase().replace(/[\s-]/g, '');
}

export const formatClaimCode = code => `${code.slice(0, 4)}-${code.slice(4)}`;

export function hashSecret(secret) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(secret), salt, 32, SCRYPT_PARAMS);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifySecret(secret, stored) {
  const [scheme, saltText, hashText] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, 'base64url');
  const actual = scryptSync(String(secret ?? ''), Buffer.from(saltText, 'base64url'), expected.length, SCRYPT_PARAMS);
  return timingSafeEqual(actual, expected);
}
