import test from 'node:test';
import assert from 'node:assert/strict';

import { FAMILIES, BY_ID, generateChallenge, publicView, familyForHour } from '../src/core/challenges/index.js';
import { execute, affinePower } from '../src/core/challenges/vm.js';
import { rngFor } from '../src/core/rng.js';
import { sha256, leadingZeroBits } from '../src/core/util.js';
import { ultraIndex } from '../src/core/difficulty.js';

const SEED = 'test-race';
const hoursFor = (family) => [family.minHour, family.minHour + 7, family.minHour + 23]
  .filter((h) => h <= family.maxHour);

test('every family verifies the answer it generated', () => {
  for (const family of FAMILIES) {
    if (family.id === 'pow') continue; // no canonical answer — covered separately
    for (const hour of hoursFor(family)) {
      const challenge = family.generate(hour, rngFor(SEED, family.id, hour));
      assert.ok(
        family.verify(challenge.answer, challenge),
        `${family.id} failed to verify its own answer at hour ${hour}`,
      );
    }
  }
});

test('every family rejects a wrong answer', () => {
  for (const family of FAMILIES) {
    for (const hour of hoursFor(family)) {
      const challenge = family.generate(hour, rngFor(SEED, family.id, hour));
      for (const wrong of ['', '   ', 'wrong', '0', '1,2,3', null, undefined, '../../etc/passwd']) {
        assert.equal(
          family.verify(wrong, challenge), false,
          `${family.id} accepted ${JSON.stringify(wrong)} at hour ${hour}`,
        );
      }
    }
  }
});

test('proof of work accepts a mined nonce and rejects a lazy one', () => {
  const family = BY_ID.pow;
  const challenge = family.generate(1, rngFor(SEED, 'pow', 1)); // low bit count
  challenge.target = 10;
  let nonce = null;
  for (let n = 0; n < 5_000_000 && nonce === null; n++) {
    const candidate = n.toString(36);
    if (leadingZeroBits(sha256(challenge.prefix + candidate)) >= 10) nonce = candidate;
  }
  assert.ok(nonce, 'could not mine a 10-bit nonce');
  assert.ok(family.verify(nonce, challenge));
  assert.equal(family.verify('definitely-not-it', challenge), false);
  assert.equal(family.verify('x'.repeat(65), challenge), false, 'oversized nonce must be rejected');
});

test('generation is deterministic for a seed and hour', () => {
  for (let hour = 1; hour <= 25; hour++) {
    const a = generateChallenge(SEED, hour);
    const b = generateChallenge(SEED, hour);
    assert.deepEqual(publicView(a), publicView(b));
    assert.equal(a.answer, b.answer);
  }
});

test('a different seed produces a different race', () => {
  const a = Array.from({ length: 12 }, (_, i) => generateChallenge('seed-a', i + 1));
  const b = Array.from({ length: 12 }, (_, i) => generateChallenge('seed-b', i + 1));
  assert.notDeepEqual(a.map((c) => c.answer), b.map((c) => c.answer));
});

test('the public view never carries the answer', () => {
  for (let hour = 1; hour <= 40; hour++) {
    const challenge = generateChallenge(SEED, hour);
    const view = publicView(challenge);

    assert.equal(view.answer, undefined);
    assert.equal(view.verify, undefined);
    for (const key of Object.keys(view)) {
      assert.ok(!key.startsWith('_'), `hour ${hour} exposed internal key ${key}`);
    }

    // Salvage answers are a handful of characters drawn from a published
    // alphabet, so a substring scan says nothing. The real invariant is that
    // every hole is still a hole.
    if (challenge.family === 'salvage') {
      for (const position of view.data.positions) {
        assert.equal(view.data.redacted[position], '█', `hour ${hour} left a hole filled in`);
      }
      continue;
    }
    if (!challenge.answer) continue;
    assert.ok(
      !JSON.stringify(view.data).includes(String(challenge.answer)),
      `hour ${hour} (${challenge.family}) leaked its answer into the puzzle data`,
    );
  }
});

test('difficulty never decreases', () => {
  for (let hour = 2; hour <= 120; hour++) {
    assert.ok(ultraIndex(hour) > ultraIndex(hour - 1), `hour ${hour} was not harder than ${hour - 1}`);
  }
  for (const family of FAMILIES) {
    for (let hour = family.minHour + 1; hour <= Math.min(family.maxHour, 90); hour++) {
      assert.ok(
        family.workBits(hour) >= family.workBits(hour - 1),
        `${family.id} got cheaper between hour ${hour - 1} and ${hour}`,
      );
    }
  }
});

test('no family is a soft touch at the hour it runs', () => {
  // Whichever family comes up, the hour should cost about the same. Below the
  // curve is fine early — the warm-up hours are meant to be cheap, and human
  // effort rather than machine work dominates there — but once the race is
  // properly under way nobody gets a free hour, and nothing ever spikes.
  for (let hour = 1; hour <= 70; hour++) {
    const target = 12 + 0.75 * hour;
    for (const family of FAMILIES) {
      if (hour < family.minHour || hour > family.maxHour) continue;
      const cost = family.workBits(hour);
      assert.ok(
        cost <= target + 6,
        `${family.id} spikes at hour ${hour}: 2^${cost.toFixed(0)} against a curve of 2^${target.toFixed(0)}`,
      );
      if (hour >= 12) {
        assert.ok(
          cost >= target - 9,
          `${family.id} is a free hour at ${hour}: 2^${cost.toFixed(0)} against 2^${target.toFixed(0)}`,
        );
      }
    }
  }
});

test('the schedule stays varied and starts gently', () => {
  const schedule = Array.from({ length: 80 }, (_, i) => familyForHour(SEED, i + 1));
  for (let i = 1; i < schedule.length; i++) {
    assert.notEqual(schedule[i], schedule[i - 1], `hour ${i + 1} repeated the previous family`);
  }
  for (let i = 4; i < schedule.length; i++) {
    const window = schedule.slice(i - 4, i + 1);
    const worst = Math.max(...window.map((id) => window.filter((x) => x === id).length));
    assert.ok(worst <= 2, `five-hour window at ${i + 1} used one family ${worst} times`);
  }
  for (const hour of [1, 2]) {
    const family = BY_ID[schedule[hour - 1]];
    assert.ok(family.minHour <= hour, `hour ${hour} used ${family.id}, which unlocks at ${family.minHour}`);
  }
});

test('every hour of a long race generates without throwing', () => {
  for (let hour = 1; hour <= 60; hour++) {
    const challenge = generateChallenge(SEED, hour);
    assert.ok(challenge.brief.length > 20);
    assert.ok(challenge.title);
    assert.ok(Object.keys(challenge.data).length > 0);
  }
});

test('the stack VM closed form agrees with actually running the bytecode', () => {
  let checked = 0;
  for (let hour = BY_ID.vm.minHour; hour <= BY_ID.vm.maxHour; hour++) {
    // Only the hours you could still brute-force; past those, emulating is the
    // losing strategy the puzzle is built around.
    if (BY_ID.vm.params(hour).iterations > 300_000) continue;
    const challenge = BY_ID.vm.generate(hour, rngFor(SEED, 'vm', hour));
    const emulated = execute(Buffer.from(challenge.data.bytecode, 'hex'), { maxSteps: 20_000_000 });
    assert.equal(
      emulated.output[0].toString(), challenge.answer,
      `hour ${hour}: emulation and closed form disagree`,
    );
    checked++;
  }
  assert.ok(checked >= 10, `only cross-checked ${checked} hours`);
});

test('affinePower composes the map the same way a loop would', () => {
  const M = 1n << 32n;
  const A = 1103515245n, B = 12345n;
  let expected = 7n;
  for (let i = 0; i < 500; i++) expected = (A * expected + B) % M;
  const { a, b } = affinePower(A, B, 500n);
  assert.equal((a * 7n + b) % M, expected);
});

test('the VM refuses to run away', () => {
  const forever = Buffer.from([0x01, 0, 0, 0, 1, 0x0e, 0xff, 0xf8]); // PUSH 1; JMP -8, back to 0
  assert.throws(() => execute(forever, { maxSteps: 10000 }), /step limit/);
});
