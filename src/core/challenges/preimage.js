import { sha256hex } from '../util.js';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A keyspace with a hash at the end of it. One extra character every five and a
 * half hours, and each one costs you 36x.
 */
export default {
  id: 'preimage',
  name: 'Keyspace',
  minHour: 6,
  maxHour: Infinity,
  blurb: 'The whole keyspace, and one hash to check it against.',

  params(hour) {
    return { length: Math.min(Math.round(2.3 + hour * 0.145), 14) };
  },

  workBits(hour) {
    return this.params(hour).length * Math.log2(36);
  },

  generate(hour, rng) {
    const { length } = this.params(hour);
    const secret = rng.string(ALPHABET, length);
    const salt = rng.string('0123456789abcdef', 8);
    const digest = sha256hex(salt + secret);
    const space = Math.pow(ALPHABET.length, length);

    return {
      title: 'Keyspace',
      brief:
        `A secret of exactly ${length} characters was drawn from [a-z0-9]. ` +
        `You are given SHA-256(salt + secret) as hex, and the salt in the clear. ` +
        `The keyspace is 36^${length} ~ 2^${Math.round(Math.log2(space))}.`,
      data: { salt, digest, alphabet: ALPHABET, length, keyspace: `36^${length}` },
      answerFormat: 'the secret itself',
      answer: secret,
      salt,
      digest,
    };
  },

  verify(submission, challenge) {
    const guess = String(submission ?? '').trim().toLowerCase();
    if (guess.length !== challenge.data.length) return false;
    return sha256hex(challenge.salt + guess) === challenge.digest;
  },
};
