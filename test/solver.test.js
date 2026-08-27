import test from 'node:test';
import assert from 'node:assert/strict';

import { generateChallenge, publicView, FAMILIES } from '../src/core/challenges/index.js';
import { solve } from '../tools/solver.js';

/**
 * These are the "is this race actually runnable" tests. The solvers only ever
 * see the public view, so if they can clear an hour, so can a competitor with
 * the same idea and better hardware.
 */

test('the reference solvers clear the opening hours from the public view alone', async (t) => {
  for (let hour = 1; hour <= 10; hour++) {
    const full = generateChallenge('solver-test', hour);
    const answer = solve(publicView(full), { budgetMs: 20_000 });
    assert.ok(answer !== null, `hour ${hour} (${full.family}) was unsolvable`);
    assert.ok(full.verify(answer), `hour ${hour} (${full.family}) produced a wrong answer`);
  }
});

test('every family is solvable at the hour it unlocks', () => {
  for (const family of FAMILIES) {
    // Find the first hour this family actually runs, then solve that hour.
    let hour = family.minHour;
    let full = generateChallenge(`unlock-${family.id}`, hour);
    for (let probe = family.minHour; probe <= family.minHour + 40 && full.family !== family.id; probe++) {
      hour = probe;
      full = generateChallenge(`unlock-${family.id}`, probe);
    }
    assert.equal(full.family, family.id, `never scheduled ${family.id} to test`);

    const answer = solve(publicView(full), { budgetMs: 25_000 });
    assert.ok(answer !== null, `${family.id} was unsolvable at hour ${hour}`);
    assert.ok(full.verify(answer), `${family.id} produced a wrong answer at hour ${hour}`);
  }
});

test('a solver that runs out of time says so instead of guessing', () => {
  const full = generateChallenge('solver-test', 60);
  const answer = solve(publicView(full), { budgetMs: 250 });
  if (answer !== null) assert.ok(full.verify(answer), 'a returned answer must be a real one');
});

test('an unknown family is not a crash', () => {
  assert.equal(solve({ family: 'nonsense', data: {} }, { budgetMs: 10 }), null);
  assert.equal(solve({ family: 'cipher', data: {} }, { budgetMs: 10 }), null);
});
