import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256 = (input) =>
  createHash('sha256').update(typeof input === 'string' ? Buffer.from(input, 'utf8') : input).digest();

export const sha256hex = (input) => sha256(input).toString('hex');

/** Count leading zero *bits* of a buffer. */
export function leadingZeroBits(buf) {
  let bits = 0;
  for (const byte of buf) {
    if (byte === 0) { bits += 8; continue; }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

export const token = (bytes = 24) => randomBytes(bytes).toString('hex');

/** Compare two strings without leaking length/position through timing. */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Answers are compared loosely: trimmed, collapsed whitespace, case-folded. */
export const normalize = (s) =>
  String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** 2 -> "02", used all over the clock rendering. */
export const pad2 = (n) => String(n).padStart(2, '0');

export function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

/** modular exponentiation on BigInt */
export function modPow(base, exp, mod) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}

/**
 * Miller-Rabin with fixed bases. Deterministic on purpose: challenge generation
 * must produce the exact same numbers on every process start.
 */
export function isProbablePrime(n) {
  if (n < 2n) return false;
  const smallPrimes = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n];
  for (const p of smallPrimes) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let r = 0n;
  while (d % 2n === 0n) { d /= 2n; r++; }
  for (const a of smallPrimes) {
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let j = 1n; j < r; j++) {
      x = (x * x) % n;
      if (x === n - 1n) { composite = false; break; }
    }
    if (composite) return false;
  }
  return true;
}

/** Next prime >= n (deterministic). */
export function nextPrime(n) {
  let c = n % 2n === 0n ? n + 1n : n;
  while (!isProbablePrime(c)) c += 2n;
  return c;
}
