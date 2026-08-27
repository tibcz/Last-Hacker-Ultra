import { sha256, leadingZeroBits } from '../util.js';

/**
 * The purest hour on the board: no insight, no trick, just hashes per second
 * against a clock. Doubles in cost every ~1.6 hours.
 */
export default {
  id: 'pow',
  name: 'Grind',
  minHour: 4,
  maxHour: Infinity,
  blurb: 'Burn cycles until the hash gets quiet.',

  params(hour) {
    return { bits: Math.round(12 + hour * 0.75) };
  },

  workBits(hour) {
    return this.params(hour).bits;
  },

  generate(hour, rng) {
    const { bits } = this.params(hour);
    const prefix = `LHU:${hour}:${rng.string('abcdef0123456789', 16)}`;
    return {
      title: 'Grind',
      brief:
        `Find any nonce such that SHA-256("${prefix}" + nonce) begins with at least ` +
        `${bits} zero bits. The nonce may be any string of up to 64 printable characters. ` +
        `Expect around 2^${bits} hashes.`,
      data: { prefix, bits, algorithm: 'sha256', expectedHashes: `2^${bits}` },
      answerFormat: 'the nonce, nothing else',
      answer: null,
      target: bits,
      prefix,
    };
  },

  verify(submission, challenge) {
    const nonce = String(submission ?? '').trim();
    if (!nonce || nonce.length > 64) return false;
    const digest = sha256(challenge.prefix + nonce);
    return leadingZeroBits(digest) >= challenge.target;
  },
};
