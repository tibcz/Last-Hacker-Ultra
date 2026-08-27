/**
 * One bot, one worker thread.
 *
 * Bots are CPU-bound by design — they run the same reference solvers a human
 * would write — so each one gets its own thread and its own slice of the hour.
 * A bot is two numbers: `skill`, how much of the hour it is willing to spend,
 * and `power`, what its machine is worth. They are deliberately not the same
 * axis — the patient hacker on a laptop and the impatient one with a rig go
 * out in different hours, which is what makes a field rather than a cliff.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { solve } from './solver.js';

const { baseUrl, handle, skill, power = 1, flake = 0, seed = 1 } = workerData;

let rng = seed >>> 0;
const random = () => {
  rng = (rng * 1664525 + 1013904223) >>> 0;
  return rng / 4294967296;
};

const say = (type, detail) => parentPort?.postMessage({ handle, type, ...detail });

/** The race ending pulls the server out from under any request in flight. */
const GONE = Symbol('server gone');

async function get(path, token) {
  try {
    const res = await fetch(baseUrl + path, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return res.json().catch(() => ({}));
  } catch {
    return GONE;
  }
}

async function post(path, body, token) {
  try {
    const res = await fetch(baseUrl + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
  } catch {
    return GONE;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const entry = await post('/api/signup', { handle });
  if (entry === GONE) return;
  if (!entry.token) { say('error', { error: entry.error ?? 'signup refused' }); return; }
  const token = entry.token;
  say('joined', {});

  let solvedHour = 0;
  for (;;) {
    const race = await get('/api/state');
    if (race === GONE) return;
    if (race.status === 'finished') { say('done', {}); return; }
    if (race.status !== 'running') { await sleep(300); continue; }

    const me = await get('/api/me', token);
    if (me === GONE) return;
    if (me.status === 'out') { say('out', { hour: me.eliminatedHour }); return; }
    if (me.solvedCurrentHour || solvedHour === race.hour) { await sleep(400); continue; }

    const challenge = await get('/api/challenge');
    if (challenge === GONE) return;
    if (!challenge.family) { await sleep(300); continue; }

    // Some hours you just do not get out of the tent.
    if (random() < flake) {
      say('skip', { hour: race.hour });
      solvedHour = race.hour;
      continue;
    }

    const budget = Math.max(500, Math.min(race.msToBell - 400, race.hourSeconds * 1000 * skill));
    const started = Date.now();
    const answer = solve(challenge, { budgetMs: budget, power });
    const spent = Date.now() - started;

    if (answer === null) {
      say('stuck', { hour: race.hour, spent, family: challenge.family });
      solvedHour = race.hour;
      await sleep(500);
      continue;
    }

    const result = await post('/api/submit', { answer }, token);
    if (result === GONE) return;
    if (result.correct) {
      solvedHour = race.hour;
      say('solved', { hour: race.hour, spent, family: challenge.family, place: result.place });
    } else {
      say('rejected', { hour: race.hour, family: challenge.family, error: result.error });
      await sleep(1000);
    }
  }
}

run().catch((err) => say('error', { error: err.message }));
