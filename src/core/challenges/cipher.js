import { WORDS, FLAVOR } from './words.js';
import { normalize } from '../util.js';

const A = 'abcdefghijklmnopqrstuvwxyz';

const caesar = (text, shift) =>
  text.replace(/[a-z]/g, (c) => A[(A.indexOf(c) + shift + 26) % 26]);

function vigenere(text, key, dir = 1) {
  let k = 0;
  return text.replace(/[a-z]/g, (c) => {
    const shift = A.indexOf(key[k++ % key.length]) * dir;
    return A[(A.indexOf(c) + shift + 26) % 26];
  });
}

function xorHex(text, key) {
  const t = Buffer.from(text, 'utf8');
  const k = Buffer.from(key, 'utf8');
  return Buffer.from(t.map((b, i) => b ^ k[i % k.length])).toString('hex');
}

/**
 * Classical crypto, tightened hour by hour: Caesar -> Vigenere -> repeating-key
 * XOR, with the key growing and the ciphertext shrinking so there is less and
 * less statistical signal to attack.
 */
export default {
  id: 'cipher',
  name: 'Cold Cipher',
  minHour: 1,
  maxHour: 24,
  blurb: 'Classical crypto with a shrinking crib.',

  params(hour) {
    if (hour <= 5) return { mode: 'caesar', keyLen: 1, lines: 2 };
    if (hour <= 13) return { mode: 'vigenere', keyLen: Math.min(3 + Math.floor((hour - 6) / 3), 6), lines: hour <= 9 ? 2 : 1 };
    return { mode: 'xor', keyLen: Math.min(4 + Math.floor((hour - 14) / 2), 11), lines: 1 };
  },

  /** log2 of the work for a crib-dragging attack, which is the intended one. */
  workBits(hour) {
    const { mode, keyLen, lines } = this.params(hour);
    if (mode === 'caesar') return 5;
    if (mode === 'vigenere') return 8 + keyLen * 1.5 + (lines === 1 ? 2 : 0);
    return 14 + keyLen * 1.2;
  },

  generate(hour, rng) {
    const { mode, keyLen, lines } = this.params(hour);
    const pass = rng.pick(WORDS);
    const body = rng.sample(FLAVOR, lines).join(' ');
    const plain = `${body} checkpoint ${pass}`;

    let ciphertext, brief;
    if (mode === 'caesar') {
      const shift = rng.int(3, 23);
      ciphertext = caesar(plain, shift);
      brief =
        'A single rotation stands between you and the checkpoint. ' +
        'The plaintext is lowercase English; the word after "checkpoint" is your answer.';
    } else if (mode === 'vigenere') {
      const key = rng.string(A, keyLen);
      ciphertext = vigenere(plain, key, 1);
      brief =
        `Vigenere, key length ${keyLen}, lowercase alphabet, spaces left intact. ` +
        'The plaintext contains the word "checkpoint" followed by your answer.';
    } else {
      const key = rng.string(A + '0123456789', keyLen);
      ciphertext = xorHex(plain, key);
      brief =
        `Repeating-key XOR over the raw bytes, hex encoded. Key length ${keyLen}, ` +
        'key is lowercase alphanumeric. The plaintext contains "checkpoint" followed by your answer.';
    }

    return {
      title: mode === 'caesar' ? 'Rotation' : mode === 'vigenere' ? 'Running Key' : 'Repeating Key',
      brief,
      data: { mode, keyLength: keyLen, ciphertext },
      answerFormat: 'the single word that follows "checkpoint" in the plaintext',
      answer: pass,
    };
  },

  verify(submission, challenge) {
    return normalize(submission) === normalize(challenge.answer);
  },
};
