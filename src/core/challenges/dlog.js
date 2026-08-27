import { modPow, isProbablePrime } from '../util.js';

/**
 * Discrete log in a prime field, over a safe prime so Pohlig-Hellman has
 * nothing to chew on. Baby-step giant-step costs sqrt(p) in both time and
 * memory, and p gains a bit every hour.
 */
export default {
  id: 'dlog',
  name: 'Logarithm',
  minHour: 12,
  maxHour: Infinity,
  blurb: 'Undo an exponentiation the slow way.',

  params(hour) {
    return { bits: Math.min(24 + Math.round(hour * 1.5), 120) };
  },

  /** Pollard rho over the order-q subgroup: sqrt of the group order. */
  workBits(hour) {
    return this.params(hour).bits / 2;
  },

  generate(hour, rng) {
    const { bits } = this.params(hour);

    // Safe prime p = 2q + 1: the subgroup structure leaves no easy factors.
    let p = 0n, q = 0n;
    for (let attempt = 0; attempt < 200000; attempt++) {
      let candidate = 0n;
      for (let b = 0; b < bits - 1; b++) candidate = (candidate << 1n) | BigInt(rng.int(0, 1));
      candidate |= 1n << BigInt(bits - 2);
      candidate |= 1n;
      if (!isProbablePrime(candidate)) continue;
      const maybeP = 2n * candidate + 1n;
      if (!isProbablePrime(maybeP)) continue;
      q = candidate;
      p = maybeP;
      break;
    }

    // Any non-trivial square is a generator of the order-q subgroup.
    let g = 0n;
    for (let base = 2n; base < 100n; base++) {
      const cand = modPow(base, 2n, p);
      if (cand !== 1n && modPow(cand, q, p) === 1n) { g = cand; break; }
    }

    const x = BigInt(rng.int(1, 1 << 30)) * BigInt(rng.int(1, 1 << 30)) % (q - 2n) + 1n;
    const h = modPow(g, x, p);

    return {
      title: 'Logarithm',
      brief:
        `Solve g^x = h (mod p) for x, where p is a ${bits}-bit safe prime and g generates ` +
        `the subgroup of order (p-1)/2. Baby-step giant-step costs about 2^${Math.round(bits / 2)} ` +
        'operations and the same in memory.',
      data: { p: p.toString(), g: g.toString(), h: h.toString(), bits },
      answerFormat: 'x as a decimal integer',
      answer: x.toString(),
      p: p.toString(),
      g: g.toString(),
      h: h.toString(),
    };
  },

  verify(submission, challenge) {
    const raw = String(submission ?? '').trim();
    if (!/^\d+$/.test(raw)) return false;
    const x = BigInt(raw);
    const p = BigInt(challenge.p);
    if (x <= 0n || x >= p) return false;
    return modPow(BigInt(challenge.g), x, p) === BigInt(challenge.h);
  },
};
