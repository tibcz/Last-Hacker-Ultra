/**
 * Reference solvers.
 *
 * Every one of these works from the *public* view of a challenge — the same
 * bytes a competitor gets — so they double as proof that each hour is actually
 * solvable, and as the brains of the demo bots. Each takes a time budget and
 * gives up honestly when it runs out, which is the only realistic way to model
 * a hacker who has one hour.
 */

import { createHash } from 'node:crypto';
import { modPow } from '../src/core/util.js';
import { execute, OPS } from '../src/core/challenges/vm.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const A = 'abcdefghijklmnopqrstuvwxyz';
const CRIB = 'checkpoint ';

const deadline = (budgetMs) => Date.now() + budgetMs;
const expired = (until) => Date.now() > until;

/* ------------------------------------------------------------------ cipher -- */

const caesarShift = (text, n) => text.replace(/[a-z]/g, (c) => A[(A.indexOf(c) + n + 26) % 26]);

function solveCipher(challenge) {
  const { mode, ciphertext, keyLength } = challenge.data;

  if (mode === 'caesar') {
    for (let shift = 1; shift < 26; shift++) {
      const plain = caesarShift(ciphertext, -shift);
      const word = afterCrib(plain);
      if (word) return word;
    }
    return null;
  }

  if (mode === 'vigenere') {
    // The crib is worth more than the frequencies: "checkpoint " somewhere in
    // the plaintext pins down keyLength consecutive key letters wherever it sits.
    const letters = [...ciphertext].filter((c) => /[a-z]/.test(c));
    for (let offset = 0; offset + CRIB.length <= letters.length; offset++) {
      const key = new Array(keyLength).fill(null);
      let consistent = true;
      const cribLetters = [...CRIB].filter((c) => /[a-z]/.test(c));
      for (let i = 0; i < cribLetters.length && consistent; i++) {
        const slot = (offset + i) % keyLength;
        const shift = (A.indexOf(letters[offset + i]) - A.indexOf(cribLetters[i]) + 26) % 26;
        if (key[slot] !== null && key[slot] !== shift) consistent = false;
        key[slot] = shift;
      }
      if (!consistent || key.includes(null)) continue;

      let k = 0;
      const plain = ciphertext.replace(/[a-z]/g, (c) => A[(A.indexOf(c) - key[k++ % keyLength] + 26) % 26]);
      const word = afterCrib(plain);
      if (word) return word;
    }
    return null;
  }

  // Repeating-key XOR: same crib, over bytes this time.
  const bytes = Buffer.from(ciphertext, 'hex');
  for (let offset = 0; offset + CRIB.length <= bytes.length; offset++) {
    const key = new Array(keyLength).fill(null);
    let consistent = true;
    for (let i = 0; i < CRIB.length && consistent; i++) {
      const slot = (offset + i) % keyLength;
      const b = bytes[offset + i] ^ CRIB.charCodeAt(i);
      if (key[slot] !== null && key[slot] !== b) consistent = false;
      key[slot] = b;
    }
    if (!consistent || key.includes(null)) continue;
    const plain = Buffer.from(bytes.map((b, i) => b ^ key[i % keyLength])).toString('latin1');
    const word = afterCrib(plain);
    if (word) return word;
  }
  return null;
}

function afterCrib(plain) {
  const match = /checkpoint\s+([a-z]{3,})/.exec(plain);
  return match ? match[1] : null;
}

/* ---------------------------------------------------------------- encoding -- */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const MORSE_REV = Object.fromEntries(Object.entries({
  a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....',
  i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.',
  q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-',
  y: '-.--', z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
  5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
}).map(([k, v]) => [v, k]));

const printable = (s) => s.length > 0 && s.length < 60000 && !/[\x00-\x08\x0e-\x1f\x7f]/.test(s);

const DECODERS = [
  { id: 'hex', try: (s) => (/^[0-9a-f]+$/i.test(s) && s.length % 2 === 0 ? Buffer.from(s, 'hex').toString('latin1') : null) },
  { id: 'base64', try: (s) => (/^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length % 4 === 0 ? Buffer.from(s, 'base64').toString('latin1') : null) },
  { id: 'base32', try: (s) => (/^[A-Z2-7]+=*$/.test(s) ? fromBase32(s) : null) },
  { id: 'decimal', try: (s) => (/^\d{1,3}( \d{1,3})+$/.test(s) ? s.split(' ').map((n) => String.fromCharCode(+n)).join('') : null) },
  { id: 'binary', try: (s) => (/^[01]{8}( [01]{8})*$/.test(s) ? s.split(' ').map((b) => String.fromCharCode(parseInt(b, 2))).join('') : null) },
  { id: 'morse', try: (s) => (/^[.\-/ ]+$/.test(s) ? s.split(' ').map((t) => (t === '/' ? ' ' : MORSE_REV[t] ?? '?')).join('') : null) },
  { id: 'reverse', try: (s) => [...s].reverse().join('') },
  { id: 'rot13', try: (s) => s.replace(/[a-zA-Z]/g, (c) => { const b = c <= 'Z' ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b); }) },
  { id: 'rot5', try: (s) => s.replace(/[0-9]/g, (d) => String((+d + 5) % 10)) },
  { id: 'atbash', try: (s) => s.replace(/[a-zA-Z]/g, (c) => (c <= 'Z' ? String.fromCharCode(155 - c.charCodeAt(0)) : String.fromCharCode(219 - c.charCodeAt(0)))) },
];

function fromBase32(input) {
  const clean = input.replace(/=+$/, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out).toString('latin1');
}

/** Breadth-first peel. Cycles are pruned by remembering every string we have seen. */
function solveEncoding(challenge, until) {
  const start = challenge.data.payload;
  const seen = new Set([start]);
  let frontier = [start];
  const maxDepth = (challenge.data.depth ?? 8) + 3;

  for (let depth = 0; depth <= maxDepth; depth++) {
    const next = [];
    for (const current of frontier) {
      if (expired(until)) return null;
      const word = afterCrib(current);
      if (word) return word;
      for (const decoder of DECODERS) {
        let out;
        try { out = decoder.try(current); } catch { out = null; }
        if (!out || out === current || seen.has(out) || !printable(out)) continue;
        seen.add(out);
        next.push(out);
        if (seen.size > 60000) return null;
      }
    }
    if (!next.length) return null;
    frontier = next;
  }
  return null;
}

/* --------------------------------------------------------------------- vm -- */

/**
 * Disassemble, find the affine accumulator loop, and close the form. This is
 * the intended solution: the loop counts are chosen so that emulating is a
 * losing strategy long before the hour runs out.
 */
function solveVm(challenge, until) {
  const code = Buffer.from(challenge.data.bytecode, 'hex');
  const M = 1n << 32n;

  const ins = [];
  let ip = 0;
  while (ip < code.length) {
    const at = ip;
    const op = code[ip++];
    let arg = null;
    if (op === OPS.PUSH) { arg = BigInt(code.readUInt32BE(ip)); ip += 4; }
    else if (op === OPS.LOAD || op === OPS.STORE) { arg = code[ip++]; }
    else if (op === OPS.JNZ || op === OPS.JMP) { arg = code.readInt16BE(ip); ip += 2; }
    ins.push({ at, op, arg, next: ip });
  }
  const byOffset = new Map(ins.map((i, idx) => [i.at, idx]));

  // Registers seeded before the loops, plus the counters and the affine steps.
  const initial = new Map();
  const affine = new Map();   // reg -> {A, B}
  const counters = new Map(); // reg -> iterations
  let inLoop = false;
  let finalKey = 0n;
  let xorOrder = [];

  for (let i = 0; i < ins.length; i++) {
    const cur = ins[i];
    if (cur.op === OPS.PUSH && ins[i + 1]?.op === OPS.STORE) {
      const reg = ins[i + 1].arg;
      if (!inLoop) initial.set(reg, cur.arg);
      counters.set(reg, cur.arg);
      continue;
    }
    if (cur.op === OPS.LOAD && ins[i + 1]?.op === OPS.PUSH && ins[i + 2]?.op === OPS.MUL
        && ins[i + 3]?.op === OPS.PUSH && ins[i + 4]?.op === OPS.ADD && ins[i + 5]?.op === OPS.STORE
        && ins[i + 5].arg === cur.arg) {
      inLoop = true;
      affine.set(cur.arg, { A: ins[i + 1].arg, B: ins[i + 3].arg });
      i += 5;
      continue;
    }
    if (cur.op === OPS.JNZ) {
      const target = cur.next + cur.arg;
      const back = byOffset.get(target);
      if (back !== undefined && back < i) inLoop = true;
      continue;
    }
    if (cur.op === OPS.LOAD && affine.has(cur.arg) && !xorOrder.includes(cur.arg) && i > 5) {
      // epilogue reads
      const rest = ins.slice(i);
      if (rest.some((r) => r.op === OPS.OUT)) xorOrder.push(cur.arg);
    }
    if (cur.op === OPS.PUSH && ins[i + 1]?.op === OPS.XOR && ins[i + 2]?.op === OPS.OUT) finalKey = cur.arg;
  }

  if (!affine.size) {
    try { return execute(code, { maxSteps: 200_000_000 }).output[0]?.toString() ?? null; }
    catch { return null; }
  }

  // The counters are whatever registers the loops decrement: everything stored
  // before the first affine update that is not an accumulator.
  const loopCounts = [...counters.entries()]
    .filter(([reg]) => !affine.has(reg))
    .map(([, value]) => value);
  const total = loopCounts.reduce((acc, n) => acc * n, 1n);
  if (total <= 0n) return null;
  if (expired(until)) return null;

  let result = null;
  for (const [reg, { A, B }] of affine) {
    const { a, b } = affinePower(A, B, total, M);
    const value = (a * (initial.get(reg) ?? 0n) + b) % M;
    result = result === null ? value : result ^ value;
  }
  return ((result ^ finalKey) % M).toString();
}

function affinePower(A, B, n, M) {
  let a = 1n, b = 0n, ba = A % M, bb = B % M, e = n;
  while (e > 0n) {
    if (e & 1n) { a = (ba * a) % M; b = (ba * b + bb) % M; }
    const na = (ba * ba) % M;
    const nb = (ba * bb + bb) % M;
    ba = na; bb = nb;
    e >>= 1n;
  }
  return { a, b };
}

/* -------------------------------------------------------------------- pow -- */

function solvePow(challenge, until) {
  const { prefix, bits } = challenge.data;
  const need = bits;
  for (let n = 0; ; n++) {
    if ((n & 0x3fff) === 0 && expired(until)) return null;
    const nonce = n.toString(36);
    const digest = createHash('sha256').update(prefix + nonce).digest();
    let zeros = 0;
    for (const byte of digest) {
      if (byte === 0) { zeros += 8; continue; }
      zeros += Math.clz32(byte) - 24;
      break;
    }
    if (zeros >= need) return nonce;
  }
}

/* --------------------------------------------------------------- preimage -- */

function solvePreimage(challenge, until) {
  const { salt, digest, alphabet, length } = challenge.data;
  const n = alphabet.length;
  const idx = new Array(length).fill(0);
  let steps = 0;
  for (;;) {
    if ((steps++ & 0x1fff) === 0 && expired(until)) return null;
    const guess = idx.map((i) => alphabet[i]).join('');
    if (sha(salt + guess) === digest) return guess;
    let carry = length - 1;
    while (carry >= 0 && ++idx[carry] === n) { idx[carry] = 0; carry--; }
    if (carry < 0) return null;
  }
}

/* -------------------------------------------------------------- subsetsum -- */

/** Meet in the middle: 2^(n/2) time and memory, which buys about 20 extra hours. */
function solveSubsetSum(challenge, until, power) {
  const numbers = challenge.data.numbers.map(BigInt);
  const target = BigInt(challenge.data.target);
  const n = numbers.length;
  if (n > 40 + Math.round(6 * power)) return null; // how much memory you brought

  const half = Math.floor(n / 2);
  const left = new Map();
  for (let mask = 0; mask < 1 << half; mask++) {
    if ((mask & 0xffff) === 0 && expired(until)) return null;
    let sum = 0n;
    for (let b = 0; b < half; b++) if (mask & (1 << b)) sum += numbers[b];
    if (!left.has(sum)) left.set(sum, mask);
  }
  const rest = n - half;
  for (let mask = 0; mask < 1 << rest; mask++) {
    if ((mask & 0xffff) === 0 && expired(until)) return null;
    let sum = 0n;
    for (let b = 0; b < rest; b++) if (mask & (1 << b)) sum += numbers[half + b];
    const need = target - sum;
    const found = left.get(need);
    if (found === undefined) continue;
    const indices = [];
    for (let b = 0; b < half; b++) if (found & (1 << b)) indices.push(b + 1);
    for (let b = 0; b < rest; b++) if (mask & (1 << b)) indices.push(half + b + 1);
    if (indices.length) return indices.join(',');
  }
  return null;
}

/* ---------------------------------------------------------------- salvage -- */

function solveSalvage(challenge, until) {
  const { redacted, digest, alphabet, positions } = challenge.data;
  const chars = [...redacted];
  const holes = positions.length;
  const idx = new Array(holes).fill(0);
  const n = alphabet.length;
  let steps = 0;
  for (;;) {
    if ((steps++ & 0x1fff) === 0 && expired(until)) return null;
    positions.forEach((p, i) => { chars[p] = alphabet[idx[i]]; });
    if (sha(chars.join('')) === digest) return positions.map((_, i) => alphabet[idx[i]]).join('');
    let carry = holes - 1;
    while (carry >= 0 && ++idx[carry] === n) { idx[carry] = 0; carry--; }
    if (carry < 0) return null;
  }
}

/* ------------------------------------------------------------------- dlog -- */

/** Baby-step giant-step. Memory is the wall long before time is. */
function solveDlog(challenge, until, power) {
  const p = BigInt(challenge.data.p);
  const g = BigInt(challenge.data.g);
  const h = BigInt(challenge.data.h);
  const order = (p - 1n) / 2n;

  let m = 1n;
  while (m * m < order) m++;
  if (m > BigInt(Math.round(40_000_000 * power))) return null;

  const table = new Map();
  let value = 1n;
  for (let i = 0n; i < m; i++) {
    if ((i & 0xffffn) === 0n && expired(until)) return null;
    if (!table.has(value)) table.set(value, i);
    value = (value * g) % p;
  }

  const factor = modPow(modPow(g, p - 2n, p), m, p); // g^-m mod p
  let gamma = h;
  for (let i = 0n; i < m; i++) {
    if ((i & 0xffffn) === 0n && expired(until)) return null;
    const j = table.get(gamma);
    if (j !== undefined) {
      const x = i * m + j;
      if (x > 0n && modPow(g, x, p) === h) return x.toString();
    }
    gamma = (gamma * factor) % p;
  }
  return null;
}

/* ------------------------------------------------------------------- api -- */

const SOLVERS = {
  cipher: solveCipher,
  encoding: solveEncoding,
  vm: solveVm,
  pow: solvePow,
  preimage: solvePreimage,
  subsetsum: solveSubsetSum,
  salvage: solveSalvage,
  dlog: solveDlog,
};

/**
 * @param challenge the public view of a challenge
 * @param budgetMs  how long this solver is allowed to think
 * @param power     what your machine is worth, relative to a plain laptop. It
 *                  scales the ceilings that are bounded by memory rather than
 *                  time — the giant-step table, the meet-in-the-middle halves —
 *                  because that is where competitors really differ.
 * @returns the answer string, or null if it ran out of time or ideas
 */
export function solve(challenge, { budgetMs = 30_000, power = 1 } = {}) {
  const solver = SOLVERS[challenge.family];
  if (!solver) return null;
  try {
    return solver(challenge, deadline(budgetMs), power);
  } catch {
    return null;
  }
}

export { SOLVERS };
