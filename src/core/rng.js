import { createHash } from 'node:crypto';

/**
 * Deterministic, seedable PRNG (mulberry32). Every challenge in the race is
 * generated from (raceSeed, hour), so the server never has to store an answer:
 * it just regenerates the hour and re-derives it. Restart-safe by construction.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive a 32-bit integer seed from any string. */
export function seedFrom(...parts) {
  const digest = createHash('sha256').update(parts.join('␟')).digest();
  return digest.readUInt32BE(0);
}

/** An RNG bundle with the small helpers every generator wants. */
export function rngFor(...parts) {
  const next = mulberry32(seedFrom(...parts));
  const api = {
    next,
    /** float in [lo, hi) */
    float: (lo, hi) => lo + next() * (hi - lo),
    /** integer in [lo, hi] inclusive */
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    bool: (p = 0.5) => next() < p,
    shuffle: (arr) => {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    /** `n` samples from `arr` without replacement */
    sample: (arr, n) => api.shuffle(arr).slice(0, n),
    string: (alphabet, len) => {
      let s = '';
      for (let i = 0; i < len; i++) s += alphabet[Math.floor(next() * alphabet.length)];
      return s;
    },
    bytes: (n) => Buffer.from(Array.from({ length: n }, () => Math.floor(next() * 256))),
  };
  return api;
}
