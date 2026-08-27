import { createHash } from 'node:crypto';
import { token } from './util.js';
import { generateChallenge, publicView } from './challenges/index.js';
import { ultraIndex, band, BAND_LABEL } from './difficulty.js';

export const DEFAULT_CONFIG = {
  hourSeconds: 3600,      // the loop. One hour, on the hour.
  submitCooldownMs: 1500, // per hacker, so nobody brute-forces the referee
  maxHours: 0,            // 0 = the real rule: it ends when people end
  lateEntry: false,       // authentic backyard: everyone starts together
};

const HANDLE_RE = /^[a-zA-Z0-9_\-.]{2,24}$/;
const hashToken = (t) => createHash('sha256').update(t).digest('hex');

export function createRace(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...(options.config ?? {}) };
  return {
    id: options.id ?? token(8),
    name: options.name ?? 'Last Hacker Ultra',
    seed: options.seed ?? token(12),
    config,
    status: 'signup',
    createdAt: options.now ?? Date.now(),
    startsAt: options.startsAt ?? null,
    startedAt: null,
    finishedAt: null,
    hour: 0,
    hackers: {},
    results: {},
    winner: null,
    outcome: null,
    log: [],
  };
}

/* ------------------------------------------------------------------ clock -- */

export const hourMs = (race) => race.config.hourSeconds * 1000;
/** The bell that starts `hour` (1-based). */
export const bellAt = (race, hour) => race.startedAt + (hour - 1) * hourMs(race);
/** The bell that ends it. Submissions are accepted strictly before this. */
export const hourEndsAt = (race, hour) => bellAt(race, hour + 1);

export function timeLeftMs(race, now = Date.now()) {
  if (race.status !== 'running') return 0;
  return Math.max(0, hourEndsAt(race, race.hour) - now);
}

/* ------------------------------------------------------------------ people -- */

export function signup(race, handle, now = Date.now()) {
  const clean = String(handle ?? '').trim();
  if (!HANDLE_RE.test(clean)) {
    return { error: 'handle must be 2-24 chars of letters, digits, _ - or .' };
  }
  const taken = Object.values(race.hackers).some(
    (h) => h.handle.toLowerCase() === clean.toLowerCase(),
  );
  if (taken) return { error: `handle "${clean}" is already in the corral` };

  if (race.status === 'finished') return { error: 'this race is over' };
  if (race.status === 'running' && !race.config.lateEntry) {
    return { error: 'the race has started; the corral is closed' };
  }

  const secret = token(24);
  const hacker = {
    id: token(6),
    handle: clean,
    tokenHash: hashToken(secret),
    joinedAt: now,
    joinedHour: race.status === 'running' ? race.hour : 0,
    late: race.status === 'running',
    status: 'active',
    hoursDone: 0,
    eliminatedHour: null,
    attempts: 0,
    lastSubmitAt: null,
    solved: {},
  };
  race.hackers[hacker.id] = hacker;
  logEvent(race, { type: 'signup', hacker: hacker.handle, hour: race.hour }, now);
  return { hacker, token: secret };
}

export function authenticate(race, secret) {
  if (!secret) return null;
  const hash = hashToken(secret);
  return Object.values(race.hackers).find((h) => h.tokenHash === hash) ?? null;
}

export const activeHackers = (race) =>
  Object.values(race.hackers).filter((h) => h.status === 'active');

/* ------------------------------------------------------------------- race -- */

export function startRace(race, now = Date.now()) {
  if (race.status !== 'signup') return { error: 'race already started' };
  race.status = 'running';
  race.startedAt = now;
  race.hour = 1;
  race.results[1] = { startedWith: activeHackers(race).length, solvedBy: [], dnf: [] };
  logEvent(race, { type: 'start', hour: 1, starters: activeHackers(race).length }, now);
  return { ok: true };
}

/**
 * Advance the race to `now`. Safe to call from anywhere, any number of times:
 * it replays every bell that has passed since the last call, so a server that
 * was asleep for six hours wakes up with the right people eliminated.
 */
export function tick(race, now = Date.now()) {
  const events = [];

  if (race.status === 'signup' && race.startsAt && now >= race.startsAt) {
    startRace(race, race.startsAt);
    events.push({ type: 'start' });
  }
  if (race.status !== 'running') return events;

  let guard = 0;
  while (race.status === 'running' && now >= hourEndsAt(race, race.hour) && guard++ < 100000) {
    events.push(...ringBell(race, hourEndsAt(race, race.hour)));
  }
  return events;
}

/** Close the current hour, bury the dead, decide whether anyone is left. */
function ringBell(race, at) {
  const events = [];
  const closing = race.hour;
  const result = race.results[closing] ?? { startedWith: 0, solvedBy: [], dnf: [] };

  const running = activeHackers(race);
  const survivors = [];
  for (const hacker of running) {
    if (hacker.solved[closing]) {
      hacker.hoursDone = closing;
      survivors.push(hacker);
    } else {
      hacker.status = 'out';
      hacker.eliminatedHour = closing;
      result.dnf.push(hacker.id);
      events.push({ type: 'dnf', hacker: hacker.handle, hour: closing });
      logEvent(race, { type: 'dnf', hacker: hacker.handle, hour: closing }, at);
    }
  }
  race.results[closing] = result;

  // Nobody finished the loop: the classic backyard ending, no winner at all.
  if (survivors.length === 0) {
    return [...events, ...endRace(race, null, running.length ? 'no-finisher' : 'empty', at)];
  }

  // One left, and someone was still running when this hour started: they now go
  // out alone for one more hour. Finish it and the title is theirs.
  const cap = race.config.maxHours;
  if (cap && closing >= cap) {
    const champion = survivors.length === 1 ? survivors[0] : null;
    return [...events, ...endRace(race, champion, champion ? 'cap-winner' : 'cap-draw', at)];
  }

  if (survivors.length === 1) {
    const solo = survivors[0];
    if (solo.soloHour === closing) {
      // They ran the extra hour alone and finished it. One more than anyone
      // else on the board — that is the whole definition of the win.
      return [...events, ...endRace(race, solo, 'winner', at)];
    }
    if (result.startedWith > 1) {
      solo.soloHour = closing + 1;
    }
    // Otherwise they have been alone from the start. You cannot outlast nobody,
    // so the clock just keeps going until it beats them too.
  }

  race.hour = closing + 1;
  race.results[race.hour] = { startedWith: survivors.length, solvedBy: [], dnf: [] };
  events.push({ type: 'bell', hour: race.hour, remaining: survivors.length });
  logEvent(race, { type: 'bell', hour: race.hour, remaining: survivors.length }, at);
  return events;
}

function endRace(race, champion, outcome, at) {
  race.status = 'finished';
  race.finishedAt = at;
  race.outcome = outcome;

  if (champion) {
    champion.status = 'winner';
    race.winner = { id: champion.id, handle: champion.handle, hours: champion.hoursDone };
  } else {
    race.winner = null;
    // Backyard ultras call the runner-up the assist: the one who pushed the
    // field furthest. Nobody won, but somebody made it hurt.
    const best = Math.max(0, ...Object.values(race.hackers).map((h) => h.hoursDone));
    if (best > 0) {
      for (const h of Object.values(race.hackers)) {
        if (h.hoursDone === best) h.status = 'assist';
      }
    }
  }

  const event = { type: champion ? 'winner' : 'no-winner', outcome, hour: race.hour,
    hacker: champion?.handle ?? null, hours: champion?.hoursDone ?? null };
  logEvent(race, event, at);
  return [event];
}

/* -------------------------------------------------------------- submitting -- */

export function submit(race, hacker, answer, now = Date.now()) {
  if (race.status === 'signup') return { error: 'the race has not started yet' };
  if (race.status === 'finished') return { error: 'the race is over' };
  if (hacker.status !== 'active') {
    return { error: `you went out in hour ${hacker.eliminatedHour}` };
  }

  const wait = hacker.lastSubmitAt === null
    ? 0
    : race.config.submitCooldownMs - (now - hacker.lastSubmitAt);
  if (wait > 0) return { error: `slow down — ${Math.ceil(wait / 100) / 10}s`, retryAfterMs: wait };

  const hour = race.hour;
  if (hacker.solved[hour]) {
    return { ok: true, correct: true, already: true, message: 'already through. wait for the bell.' };
  }

  hacker.lastSubmitAt = now;
  hacker.attempts += 1;

  const challenge = generateChallenge(race.seed, hour);
  const correct = challenge.verify(answer);

  if (!correct) return { ok: true, correct: false, message: 'rejected' };

  hacker.solved[hour] = now;
  const result = race.results[hour] ?? (race.results[hour] = { startedWith: 0, solvedBy: [], dnf: [] });
  if (!result.solvedBy.includes(hacker.id)) result.solvedBy.push(hacker.id);

  const elapsed = now - bellAt(race, hour);
  logEvent(race, { type: 'solve', hacker: hacker.handle, hour, elapsedMs: elapsed,
    place: result.solvedBy.length }, now);

  return {
    ok: true,
    correct: true,
    message: 'through. wait for the bell.',
    place: result.solvedBy.length,
    elapsedMs: elapsed,
  };
}

/* --------------------------------------------------------------- reporting -- */

export function standings(race) {
  return Object.values(race.hackers)
    .map((h) => ({
      id: h.id,
      handle: h.handle,
      status: h.status,
      hoursDone: h.hoursDone,
      eliminatedHour: h.eliminatedHour,
      attempts: h.attempts,
      late: h.late,
      solvedCurrentHour: Boolean(h.solved[race.hour]),
      lastSolveMs: h.solved[h.hoursDone] ? h.solved[h.hoursDone] - bellAt(race, h.hoursDone) : null,
    }))
    .sort((a, b) => {
      const rank = { winner: 0, active: 1, assist: 2, out: 3 };
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      if (b.hoursDone !== a.hoursDone) return b.hoursDone - a.hoursDone;
      return (a.lastSolveMs ?? Infinity) - (b.lastSolveMs ?? Infinity);
    });
}

/** The tally board: one row per hacker, one column per hour. */
export function tally(race) {
  const hours = race.status === 'signup' ? 0 : race.hour;
  return {
    hours,
    rows: standings(race).map((s) => ({
      handle: s.handle,
      status: s.status,
      marks: Array.from({ length: hours }, (_, i) => {
        const hour = i + 1;
        const hacker = race.hackers[s.id];
        if (hacker.solved[hour]) return 'done';
        if (hacker.eliminatedHour === hour) return 'dnf';
        if (hour === race.hour && hacker.status === 'active') return 'running';
        return hacker.eliminatedHour && hour > hacker.eliminatedHour ? 'gone' : 'miss';
      }),
    })),
  };
}

export function snapshot(race, now = Date.now()) {
  const running = race.status === 'running';
  const hour = race.hour;
  return {
    id: race.id,
    name: race.name,
    status: race.status,
    hour,
    difficulty: hour ? ultraIndex(hour) : 0,
    band: hour ? band(hour) : null,
    bandLabel: hour ? BAND_LABEL[band(hour)] : null,
    hourSeconds: race.config.hourSeconds,
    startsAt: race.startsAt,
    startedAt: race.startedAt,
    finishedAt: race.finishedAt,
    serverTime: now,
    bellAt: running ? hourEndsAt(race, hour) : null,
    msToBell: running ? timeLeftMs(race, now) : null,
    remaining: activeHackers(race).length,
    entrants: Object.keys(race.hackers).length,
    winner: race.winner,
    outcome: race.outcome,
    lateEntry: race.config.lateEntry,
    standings: standings(race),
    log: race.log.slice(-40).reverse(),
  };
}

export function currentChallenge(race) {
  if (race.status !== 'running') return null;
  return publicView(generateChallenge(race.seed, race.hour));
}

/** Past hours are open for reading once their bell has rung. */
export function archivedHour(race, hour) {
  if (!Number.isInteger(hour) || hour < 1) return null;
  const closed = race.status === 'finished' ? hour <= race.hour : hour < race.hour;
  if (!closed) return null;
  const challenge = generateChallenge(race.seed, hour);
  const result = race.results[hour] ?? { startedWith: 0, solvedBy: [], dnf: [] };
  return {
    ...publicView(challenge),
    answer: challenge.answer ?? '(any valid solution)',
    result: {
      startedWith: result.startedWith,
      solved: result.solvedBy.map((id) => race.hackers[id]?.handle).filter(Boolean),
      dnf: result.dnf.map((id) => race.hackers[id]?.handle).filter(Boolean),
    },
  };
}

function logEvent(race, event, at) {
  race.log.push({ t: at, ...event });
  if (race.log.length > 400) race.log.splice(0, race.log.length - 400);
}
