import { WORDS } from './words.js';
import { normalize } from '../util.js';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Past this the payload stops being a puzzle and starts being a scroll bar. */
const MAX_PAYLOAD = 6000;

function toBase32(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  while (out.length % 8 !== 0) out += '=';
  return out;
}

const MORSE = {
  a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....',
  i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.',
  q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-',
  y: '-.--', z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
  5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
};

const rot13 = (s) =>
  s.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });

/** ROT5, the digit half of the classic pair - it bites after a numeric layer. */
const rot5 = (s) => s.replace(/[0-9]/g, (d) => String((Number(d) + 5) % 10));

const atbash = (s) =>
  s.replace(/[a-zA-Z]/g, (c) =>
    c <= 'Z' ? String.fromCharCode(155 - c.charCodeAt(0)) : String.fromCharCode(219 - c.charCodeAt(0)));

/** Every layer takes a string and returns a string. `first` layers need a clean alphabet. */
const LAYERS = [
  { id: 'base64', first: false, apply: (s) => Buffer.from(s, 'binary').toString('base64') },
  { id: 'hex', first: false, apply: (s) => Buffer.from(s, 'binary').toString('hex') },
  { id: 'base32', first: false, apply: (s) => toBase32(Buffer.from(s, 'binary')) },
  { id: 'reverse', first: false, apply: (s) => s.split('').reverse().join('') },
  { id: 'rot13', first: false, apply: rot13 },
  { id: 'rot5', first: false, apply: rot5 },
  { id: 'decimal', first: false, apply: (s) => [...s].map((c) => c.charCodeAt(0)).join(' ') },
  { id: 'binary', first: false, apply: (s) => [...s].map((c) => c.charCodeAt(0).toString(2).padStart(8, '0')).join(' ') },
  { id: 'atbash', first: false, apply: atbash },
  { id: 'morse', first: true, apply: (s) => [...s].map((c) => (c === ' ' ? '/' : MORSE[c] ?? c)).join(' ') },
];

/**
 * Nothing here is hard on its own. The work is recognising what you are looking
 * at, `depth` times in a row, with no map.
 */
export default {
  id: 'encoding',
  name: 'Onion',
  minHour: 1,
  maxHour: 16,
  blurb: 'Peel the layers. Nobody tells you what they are.',

  params(hour) {
    return { depth: Math.min(2 + Math.floor(hour / 2), 9) };
  },

  /** Recognition work, not search: each layer is a guess from a small menu. */
  workBits(hour) {
    return this.params(hour).depth * 2.5;
  },

  generate(hour, rng) {
    const { depth } = this.params(hour);
    const pass = rng.pick(WORDS);
    let payload = `checkpoint ${pass}`;

    // Build the chain by trying layers and keeping only the ones that actually
    // bite: a rot13 after a numeric layer is a free hour, not a puzzle. Also
    // refuse layers that would balloon the payload past readable size.
    const chain = [];
    if (rng.bool(0.35)) {
      const opener = rng.pick(LAYERS.filter((l) => l.first));
      chain.push(opener);
      payload = opener.apply(payload);
    }
    const pool = LAYERS.filter((l) => !l.first);
    let guard = 0;
    while (chain.length < depth && guard++ < 200) {
      const layer = rng.pick(pool);
      if (chain.length && chain[chain.length - 1].id === layer.id) continue;
      const next = layer.apply(payload);
      if (next === payload || next.length > MAX_PAYLOAD) continue;
      chain.push(layer);
      payload = next;
    }

    return {
      title: 'Onion',
      brief:
        `${chain.length} encodings were applied one after another to a short plaintext. ` +
        'You are not told which ones, or in what order. The plaintext reads ' +
        '"checkpoint <word>" — submit the word.',
      data: { depth: chain.length, payload },
      answerFormat: 'the single word after "checkpoint"',
      answer: pass,
      _chain: chain.map((l) => l.id),
    };
  },

  verify(submission, challenge) {
    return normalize(submission) === normalize(challenge.answer);
  },
};
