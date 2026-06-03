// =============================================================
// modules/crypto.js
// PIN hashing helpers using the Web Crypto API (SubtleCrypto).
//
// We never store the raw PIN. Each staff record carries a random per-user
// salt + the SHA-256 hash of (salt + pin). This is a UX/accountability gate
// (see RLS notes in supabase-sync), not a defense against a determined
// attacker — a 4-6 digit PIN is brute-forceable offline by design.
// =============================================================

const PIN_RE = /^\d{4,6}$/;

export function isValidPinFormat(pin) {
  return PIN_RE.test(String(pin || ''));
}

// 16-byte random salt as hex.
export function genSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

// SHA-256 of (salt + pin) -> hex string.
export async function hashPin(pin, salt) {
  const enc = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Constant-ish time compare (length-checked hex equality).
export async function verifyPin(pin, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const actual = await hashPin(pin, salt);
  if (actual.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  return diff === 0;
}
