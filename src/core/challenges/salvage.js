import { sha256hex } from '../util.js';
import { FLAVOR } from './words.js';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz -0123456789';

/**
 * A corrupted transmission and its checksum. Every extra redacted character
 * multiplies the search by 38.
 */
export default {
  id: 'salvage',
  name: 'Salvage',
  minHour: 10,
  maxHour: Infinity,
  blurb: 'Reconstruct the bytes the noise ate.',

  params(hour) {
    return { holes: Math.min(Math.round(2.3 + hour * 0.143), 12) };
  },

  workBits(hour) {
    return this.params(hour).holes * Math.log2(38);
  },

  generate(hour, rng) {
    const { holes } = this.params(hour);
    const message = `transmission ${rng.string('0123456789', 4)} ${rng.pick(FLAVOR)}`;
    const positions = rng.sample([...message].map((_, i) => i), holes).sort((a, b) => a - b);
    const missing = positions.map((i) => message[i]).join('');
    const redacted = [...message].map((c, i) => (positions.includes(i) ? '█' : c)).join('');
    const digest = sha256hex(message);

    return {
      title: 'Salvage',
      brief:
        `${holes} character${holes === 1 ? ' was' : 's were'} lost from this transmission. ` +
        `Every lost character came from "${ALPHABET}". ` +
        'You have the SHA-256 of the intact message. Recover the missing characters, ' +
        'left to right, as one string.',
      data: {
        redacted,
        digest,
        alphabet: ALPHABET,
        holes,
        positions,
        keyspace: `${ALPHABET.length}^${holes}`,
      },
      answerFormat: `the ${holes} missing character${holes === 1 ? '' : 's'} in order, e.g. "a1b"`,
      answer: missing,
      message,
      digest,
    };
  },

  verify(submission, challenge) {
    const guess = String(submission ?? '').toLowerCase();
    const { redacted, positions } = challenge.data;
    if (guess.length !== positions.length) return false;
    const chars = [...redacted];
    positions.forEach((p, i) => { chars[p] = guess[i]; });
    return sha256hex(chars.join('')) === challenge.digest;
  },
};
