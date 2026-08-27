import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRace, signup, authenticate, startRace, tick, submit,
  snapshot, standings, tally, currentChallenge, archivedHour, hourEndsAt,
} from '../src/core/race.js';
import { generateChallenge } from '../src/core/challenges/index.js';
import { sha256, leadingZeroBits } from '../src/core/util.js';

const HOUR = 1000; // one "hour" is one second in here

/**
 * Proof-of-work hours have no canonical answer, so the scripted races have to
 * actually mine one. At the hours these tests reach that is a few tens of
 * thousands of hashes.
 */
function answerFor(challenge) {
  if (challenge.answer !== null && challenge.answer !== undefined) return challenge.answer;
  for (let n = 0; n < 20_000_000; n++) {
    const nonce = n.toString(36);
    if (leadingZeroBits(sha256(challenge.prefix + nonce)) >= challenge.target) return nonce;
  }
  throw new Error(`could not mine hour ${challenge.hour}`);
}

function freshRace(overrides = {}) {
  return createRace({
    seed: 'unit-test',
    now: 0,
    config: { hourSeconds: HOUR / 1000, submitCooldownMs: 0, ...overrides },
  });
}

/** Run a scripted race: `plan` maps a handle to the hours it clears. */
function runRace(plan, { limit = 15, ...config } = {}) {
  const race = freshRace(config);
  const people = Object.fromEntries(
    Object.keys(plan).map((handle) => [handle, signup(race, handle, 0).hacker]),
  );
  startRace(race, 0);

  for (let hour = 1; hour <= limit && race.status === 'running'; hour++) {
    const now = (hour - 1) * HOUR + 10;
    tick(race, now);
    if (race.status !== 'running') break;
    const challenge = generateChallenge(race.seed, race.hour);
    for (const [handle, hours] of Object.entries(plan)) {
      const hacker = people[handle];
      if (hacker.status === 'active' && hours.includes(race.hour)) {
        submit(race, hacker, answerFor(challenge), now + 5);
      }
    }
    tick(race, hour * HOUR);
  }
  return { race, people };
}

test('handles are validated and unique', () => {
  const race = freshRace();
  assert.ok(signup(race, 'ada').hacker);
  assert.match(signup(race, 'ada').error, /already in the corral/);
  assert.match(signup(race, 'ADA').error, /already in the corral/);
  assert.match(signup(race, 'a').error, /2-24 chars/);
  assert.match(signup(race, 'has spaces').error, /2-24 chars/);
  assert.match(signup(race, 'x'.repeat(25)).error, /2-24 chars/);
  assert.match(signup(race, '<script>').error, /2-24 chars/);
  assert.ok(signup(race, 'a-valid.handle_1').hacker);
});

test('the corral closes at the first bell', () => {
  const race = freshRace();
  signup(race, 'ada');
  startRace(race, 0);
  assert.match(signup(race, 'latecomer').error, /corral is closed/);
});

test('late entry is allowed when the race is configured for it', () => {
  const race = freshRace({ lateEntry: true });
  signup(race, 'ada');
  startRace(race, 0);
  const late = signup(race, 'latecomer');
  assert.ok(late.hacker);
  assert.equal(late.hacker.late, true);
  assert.equal(late.hacker.joinedHour, 1);
});

test('tokens authenticate their owner and nobody else', () => {
  const race = freshRace();
  const { hacker, token } = signup(race, 'ada');
  assert.equal(authenticate(race, token).id, hacker.id);
  assert.equal(authenticate(race, 'not-a-token'), null);
  assert.equal(authenticate(race, ''), null);
  assert.equal(authenticate(race, undefined), null);
  assert.equal(race.hackers[hacker.id].token, undefined, 'raw token must not be stored');
});

test('the last hacker standing must clear one more hour to win', () => {
  const { race } = runRace({ ada: [1, 2, 3, 4, 5], turing: [1, 2, 3], grace: [1, 2] });
  assert.equal(race.status, 'finished');
  assert.equal(race.outcome, 'winner');
  assert.equal(race.winner.handle, 'ada');
  assert.equal(race.winner.hours, 5);

  const board = standings(race);
  assert.equal(board[0].handle, 'ada');
  assert.equal(board[0].status, 'winner');
  assert.equal(board[1].hoursDone, 3);
  assert.equal(board[1].eliminatedHour, 4);
});

test('a solo survivor who fails the extra hour leaves nobody the winner', () => {
  const { race } = runRace({ ada: [1, 2, 3, 4], turing: [1, 2, 3] });
  assert.equal(race.status, 'finished');
  assert.equal(race.winner, null);
  assert.equal(race.outcome, 'no-finisher');
  assert.equal(race.hackers[Object.keys(race.hackers)[0]].hoursDone, 4);
});

test('when everyone breaks in the same hour there is no winner', () => {
  const { race } = runRace({ ada: [1, 2, 3], turing: [1, 2, 3], grace: [1, 2, 3] });
  assert.equal(race.winner, null);
  assert.equal(race.outcome, 'no-finisher');
  assert.deepEqual(standings(race).map((s) => s.status), ['assist', 'assist', 'assist']);
  assert.ok(standings(race).every((s) => s.hoursDone === 3));
});

test('a solo entrant is never crowned', () => {
  const { race } = runRace({ ada: [1, 2, 3, 4, 5, 6] });
  assert.equal(race.status, 'finished');
  assert.equal(race.winner, null);
  assert.equal(standings(race)[0].hoursDone, 6);
  assert.equal(standings(race)[0].status, 'assist');
});

test('nobody clearing hour one ends it immediately', () => {
  const { race } = runRace({ ada: [], turing: [] });
  assert.equal(race.status, 'finished');
  assert.equal(race.hour, 1);
  assert.equal(race.winner, null);
  assert.ok(standings(race).every((s) => s.status === 'out' && s.hoursDone === 0));
});

test('a maxHours cap crowns whoever is alone at the cap', () => {
  const { race } = runRace(
    { ada: [1, 2, 3, 4, 5, 6], turing: [1, 2, 3, 4], grace: [1, 2, 3, 4] },
    { maxHours: 5, limit: 12 },
  );
  assert.equal(race.status, 'finished');
  assert.equal(race.outcome, 'cap-winner');
  assert.equal(race.winner.handle, 'ada');
  assert.equal(race.winner.hours, 5);
});

test('a maxHours cap with several still running is a draw, not a win', () => {
  const { race } = runRace(
    { ada: [1, 2, 3, 4, 5, 6], turing: [1, 2, 3, 4, 5, 6] },
    { maxHours: 5, limit: 12 },
  );
  assert.equal(race.status, 'finished');
  assert.equal(race.outcome, 'cap-draw');
  assert.equal(race.winner, null);
});

test('the first submission is never held back by the cooldown', () => {
  const race = freshRace({ submitCooldownMs: 5000 });
  const ada = signup(race, 'ada', 0).hacker;
  signup(race, 'turing', 0);
  startRace(race, 0);
  const result = submit(race, ada, 'definitely wrong', 1);
  assert.equal(result.correct, false, 'a fresh hacker must be able to submit immediately');
});

test('a server that was asleep catches up on every missed bell', () => {
  const race = freshRace();
  const ada = signup(race, 'ada').hacker;
  const turing = signup(race, 'turing').hacker;
  startRace(race, 0);
  const hourOne = answerFor(generateChallenge(race.seed, 1));
  submit(race, ada, hourOne, 5);
  submit(race, turing, hourOne, 5);

  // Nothing happens for six hours, then someone loads the page.
  tick(race, 6 * HOUR + 50);
  assert.equal(race.status, 'finished');
  assert.equal(race.hour, 2, 'both should have gone out at the hour-2 bell');
  assert.equal(race.winner, null);
  assert.ok(Object.values(race.hackers).every((h) => h.hoursDone === 1));
});

test('submissions are refused outside the hacker or the race being live', () => {
  const race = freshRace({ submitCooldownMs: 500 });
  const ada = signup(race, 'ada').hacker;
  signup(race, 'turing');

  assert.match(submit(race, ada, 'x', 0).error, /has not started/);
  startRace(race, 0);

  const answer = answerFor(generateChallenge(race.seed, 1));
  assert.equal(submit(race, ada, 'wrong', 10).correct, false);
  assert.match(submit(race, ada, answer, 20).error, /slow down/, 'cooldown must bite');

  const accepted = submit(race, ada, answer, 600);
  assert.equal(accepted.correct, true);
  assert.equal(accepted.place, 1);
  assert.equal(submit(race, ada, answer, 1200).already, true);

  // ada cleared hour 1 but not hour 2, and turing was already gone, so the
  // hour-2 bell ends the whole race rather than just ada's.
  tick(race, 2 * HOUR + 10);
  assert.equal(race.status, 'finished');
  assert.match(submit(race, ada, answer, 2100).error, /race is over/);
});

test('an eliminated hacker is told when they went out, while the race runs on', () => {
  const race = freshRace();
  const ada = signup(race, 'ada', 0).hacker;
  const turing = signup(race, 'turing', 0).hacker;
  const grace = signup(race, 'grace', 0).hacker;
  startRace(race, 0);

  const answer = answerFor(generateChallenge(race.seed, 1));
  submit(race, ada, answer, 10);
  submit(race, turing, answer, 10);
  // grace sits hour 1 out

  tick(race, HOUR + 10);
  assert.equal(race.status, 'running');
  assert.equal(race.hour, 2);
  assert.match(submit(race, grace, 'anything', HOUR + 20).error, /went out in hour 1/);
  assert.equal(submit(race, ada, 'wrong', HOUR + 20).correct, false, 'survivors keep racing');
});

test('an hour stays sealed until its bell has rung', () => {
  const race = freshRace();
  signup(race, 'ada');
  signup(race, 'turing');
  startRace(race, 0);

  assert.equal(archivedHour(race, 1), null, 'the live hour must stay sealed');
  assert.equal(archivedHour(race, 2), null);
  assert.equal(archivedHour(race, 0), null);
  assert.equal(archivedHour(race, -1), null);

  const live = currentChallenge(race);
  assert.equal(live.answer, undefined);

  tick(race, HOUR + 10);
  const past = archivedHour(race, 1);
  assert.ok(past.answer, 'a closed hour publishes its answer');
  assert.equal(past.result.startedWith, 2);
  assert.deepEqual(past.result.dnf.sort(), ['ada', 'turing']);
});

test('the tally board marks every hour of every hacker', () => {
  const { race } = runRace({ ada: [1, 2, 3, 4, 5], turing: [1, 2, 3], grace: [1, 2] });
  const board = tally(race);
  const rows = Object.fromEntries(board.rows.map((r) => [r.handle, r.marks]));
  assert.deepEqual(rows.ada, ['done', 'done', 'done', 'done', 'done']);
  assert.deepEqual(rows.turing, ['done', 'done', 'done', 'dnf', 'gone']);
  assert.deepEqual(rows.grace, ['done', 'done', 'dnf', 'gone', 'gone']);
});

test('the snapshot carries a usable clock', () => {
  const race = freshRace();
  signup(race, 'ada');
  startRace(race, 0);
  const view = snapshot(race, 400);
  assert.equal(view.status, 'running');
  assert.equal(view.hour, 1);
  assert.equal(view.bellAt, hourEndsAt(race, 1));
  assert.equal(view.msToBell, 600);
  assert.equal(view.remaining, 1);
  assert.ok(view.difficulty > 0);
  assert.ok(view.bandLabel);
});
