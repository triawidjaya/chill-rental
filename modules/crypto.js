// =============================================================
// modules/crypto.js
// PIN hashing helpers using the Web Crypto API (SubtleCrypto).
//
// We never store the raw PIN. Each staff record carries a random per-user
// salt + a PBKDF2-SHA256 hash, stored as "v2:<iterations>:<hex>". Legacy
// records hold a bare SHA-256(salt:pin) hex — still verifiable here, and
// lazily re-hashed to PBKDF2 on the next successful login (SessionManager).
//
// PBKDF2 makes each offline brute-force guess cost real time (~50-100ms)
// instead of nanoseconds, but a 4-6 digit PIN remains a UX/accountability
// gate (see RLS notes in supabase-sync), not a hard security boundary.
// =============================================================

const PIN_RE = /^\d{4,6}$/;

// OWASP-recommended order of magnitude for PBKDF2-SHA256.
const PBKDF2_ITERATIONS = 310000;
const V2_PREFIX = 'v2:';

export function isValidPinFormat(pin) {
  return PIN_RE.test(String(pin || ''));
}

// 16-byte random salt as hex.
export function genSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

function toHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

// PBKDF2-SHA256(pin, salt) -> hex string.
async function pbkdf2Hex(pin, salt, iterations) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(String(salt)), iterations },
    key,
    256
  );
  return toHex(new Uint8Array(bits));
}

// Legacy (pre-v2) scheme: single SHA-256 of (salt + pin). Kept verify-only.
async function legacySha256Hex(pin, salt) {
  const enc = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return toHex(new Uint8Array(digest));
}

// Current hashing scheme — self-describing so verifyPin can evolve again later.
export async function hashPin(pin, salt) {
  return `${V2_PREFIX}${PBKDF2_ITERATIONS}:${await pbkdf2Hex(pin, salt, PBKDF2_ITERATIONS)}`;
}

// True for hashes from the legacy SHA-256 scheme (no version prefix) — the
// caller should re-hash with hashPin() once the PIN has been verified.
export function isLegacyPinHash(hash) {
  return !!hash && !String(hash).startsWith(V2_PREFIX);
}

// Verifies against either scheme, picked from the stored hash's format.
export async function verifyPin(pin, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const expected = String(expectedHash);
  let actual;
  if (expected.startsWith(V2_PREFIX)) {
    const iterations = Math.max(1, Number(expected.split(':')[1]) || PBKDF2_ITERATIONS);
    actual = `${V2_PREFIX}${iterations}:${await pbkdf2Hex(pin, salt, iterations)}`;
  } else {
    actual = await legacySha256Hex(pin, salt);
  }
  return timingSafeEqual(actual, expected);
}

// Constant-ish time compare (length-checked string equality).
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
