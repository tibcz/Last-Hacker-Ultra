import { rngFor } from '../rng.js';
import { ultraIndex, band, BAND_LABEL } from '../difficulty.js';

import cipher from './cipher.js';
import encoding from './encoding.js';
import vm from './vm.js';
import pow from './pow.js';
import preimage from './preimage.js';
import subsetsum from './subsetsum.js';
import salvage from './salvage.js';
import dlog from './dlog.js';

export const FAMILIES = [cipher, encoding, vm, pow, preimage, subsetsum, salvage, dlog];
export const BY_ID = Object.fromEntries(FAMILIES.map((f) => [f.id, f]));

const eligible = (hour) => FAMILIES.filter((f) => hour >= f.minHour && hour <= f.maxHour);

/** Cached per race seed: the schedule only ever grows forward. */
const schedules = new Map();

/**
 * Which family runs in a given hour. Deterministic from the race seed, with two
 * rules: never the same family twice in a row, and never three times inside any
 * five-hour window. The gentle families age out on their own, so the mix gets
 * uglier as the night goes on without anyone having to tune it.
 */
export function familyForHour(raceSeed, hour) {
  let schedule = schedules.get(raceSeed);
  if (!schedule) { schedule = []; schedules.set(raceSeed, schedule); }

  for (let h = schedule.length + 1; h <= hour; h++) {
    const pool = eligible(h);
    const recent = schedule.slice(Math.max(0, h - 6), h - 1);
    const rng = rngFor(raceSeed, 'family', h);
    const fresh = pool.filter(
      (f) => f.id !== recent[recent.length - 1] && recent.filter((r) => r === f.id).length < 2,
    );
    const choice = rng.pick(fresh.length ? fresh : pool);
    schedule.push(choice.id);
  }
  return schedule[hour - 1];
}

/** Full challenge, answer included. Never hand this to a player. */
export function generateChallenge(raceSeed, hour) {
  const familyId = familyForHour(raceSeed, hour);
  const family = BY_ID[familyId];
  const rng = rngFor(raceSeed, 'challenge', familyId, hour);
  const generated = family.generate(hour, rng);
  const key = band(hour);

  return {
    ...generated,
    hour,
    family: familyId,
    familyName: family.name,
    blurb: family.blurb,
    difficulty: ultraIndex(hour),
    band: key,
    bandLabel: BAND_LABEL[key],
    params: family.params(hour),
    workBits: Math.round(family.workBits(hour)),
    verify: (submission) => (family.verify ?? defaultVerify)(submission, generated),
  };
}

const defaultVerify = (submission, challenge) =>
  String(submission ?? '').trim().toLowerCase() === String(challenge.answer).trim().toLowerCase();

const PUBLIC_KEYS = [
  'hour', 'family', 'familyName', 'blurb', 'title', 'brief', 'data',
  'answerFormat', 'difficulty', 'band', 'bandLabel', 'workBits',
];

/** Strict allowlist. Anything a family invents stays server-side unless it is in `data`. */
export function publicView(challenge) {
  const out = {};
  for (const key of PUBLIC_KEYS) if (challenge[key] !== undefined) out[key] = challenge[key];
  return out;
}

export function verifyAnswer(raceSeed, hour, submission) {
  return generateChallenge(raceSeed, hour).verify(submission);
}
