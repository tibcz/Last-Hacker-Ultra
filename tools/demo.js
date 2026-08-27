/**
 * A whole ultra, compressed.
 *
 *   npm run demo                      # 20-second hours, 6 bots
 *   LHU_DEMO_HOUR=45 npm run demo     # give them longer to think
 *   LHU_DEMO_BOTS=4 npm run demo
 *
 * Runs a real server, real challenges, real solvers — only the hour is shorter.
 * Watch the board thin out. Open http://localhost:3010 to see it in colour.
 */

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createRaceServer } from '../src/server/server.js';
import { snapshot, tally } from '../src/core/race.js';
import { familyForHour } from '../src/core/challenges/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.LHU_DEMO_PORT ?? 3010);
const HOUR = Number(process.env.LHU_DEMO_HOUR ?? 20);
const BOTS = Number(process.env.LHU_DEMO_BOTS ?? 6);

/**
 * The field. `skill` is how much of the hour they will spend, `power` is what
 * their machine is worth, and `flake` is the chance they simply do not come out
 * of the tent. The three are deliberately uncorrelated: the most patient hacker
 * here is on the second-worst hardware.
 */
const ROSTER = [
  { handle: 'nightshift',  skill: 0.95, power: 2.20, flake: 0.00 },
  { handle: 'coldbrew',    skill: 0.55, power: 1.20, flake: 0.02 },
  { handle: 'segfault',    skill: 0.85, power: 0.60, flake: 0.05 },
  { handle: 'ninetail',    skill: 0.35, power: 1.10, flake: 0.03 },
  { handle: 'hexdump',     skill: 0.70, power: 0.38, flake: 0.06 },
  { handle: 'kernelpanic', skill: 0.45, power: 0.40, flake: 0.09 },
  { handle: 'sudonym',     skill: 0.90, power: 0.14, flake: 0.04 },
  { handle: 'ratelimit',   skill: 0.30, power: 0.25, flake: 0.12 },
];

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  hot: (s) => `\x1b[38;5;208m${s}\x1b[0m`,
  rust: (s) => `\x1b[38;5;167m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  ink: (s) => `\x1b[38;5;252m${s}\x1b[0m`,
};

const app = createRaceServer({
  hourSeconds: HOUR,
  raceName: 'Last Hacker Ultra — demo',
  persist: false,
  adminToken: 'demo',
});

const feed = [];
const note = (line) => { feed.push(line); if (feed.length > 12) feed.shift(); };

app.server.listen(PORT, async () => {
  const baseUrl = `http://localhost:${PORT}`;
  console.log(C.hot('\n  ▚▚ LAST HACKER ULTRA — demo race'));
  console.log(C.dim(`  ${HOUR}-second hours · ${BOTS} bots · board at ${baseUrl}\n`));

  const roster = ROSTER.slice(0, BOTS);
  const workers = roster.map((bot, i) => {
    const worker = new Worker(join(here, 'bot.js'), {
      workerData: { baseUrl, ...bot, seed: 1000 + i * 77 },
    });
    worker.on('message', onBotMessage);
    worker.on('error', (err) => note(C.rust(`  ${bot.handle} crashed: ${err.message}`)));
    return worker;
  });

  // Give every bot time to reach the corral before the first bell.
  await new Promise((r) => setTimeout(r, 1200));
  const race = app.race;
  const { startRace } = await import('../src/core/race.js');
  startRace(race);
  note(C.ink(`  first bell — ${Object.keys(race.hackers).length} on the line`));

  const painter = setInterval(() => {
    paint();
    if (app.race.status === 'finished') {
      clearInterval(painter);
      paint();
      finish(workers);
    }
  }, 500);
});

function onBotMessage(msg) {
  switch (msg.type) {
    case 'solved':
      note(`  ${C.hot('✔')} ${msg.handle.padEnd(12)} cleared hour ${msg.hour} ${C.dim(`(${msg.family}, ${(msg.spent / 1000).toFixed(1)}s)`)}`);
      break;
    case 'stuck':
      note(`  ${C.rust('✕')} ${msg.handle.padEnd(12)} ran out of hour ${msg.hour} ${C.dim(`(${msg.family})`)}`);
      break;
    case 'skip':
      note(`  ${C.rust('✕')} ${msg.handle.padEnd(12)} never started hour ${msg.hour}`);
      break;
    case 'error':
      note(C.rust(`  ! ${msg.handle}: ${msg.error}`));
      break;
  }
}

function paint() {
  const race = app.race;
  const state = snapshot(race);
  const board = tally(race);
  const out = [];

  out.push('');
  out.push(`  ${C.bold('LAST HACKER ULTRA')}  ${C.dim('demo')}`);
  out.push('');

  if (state.status === 'running') {
    const left = Math.ceil(state.msToBell / 1000);
    const width = 34;
    const filled = Math.round((state.msToBell / (HOUR * 1000)) * width);
    out.push(`  hour ${C.bold(String(state.hour).padStart(2))}  ${C.hot(state.bandLabel)}  ${C.dim(familyForHour(race.seed, state.hour))}`);
    out.push(`  bell in ${C.bold(String(left).padStart(3))}s  ${C.hot('▓'.repeat(filled))}${C.dim('░'.repeat(width - filled))}`);
    out.push(`  ${C.ink(String(state.remaining))} still running · ${C.dim(`${state.entrants - state.remaining} out`)} · difficulty ${C.hot('×' + (state.difficulty / 100).toFixed(1))}`);
  } else if (state.status === 'finished') {
    out.push(state.winner
      ? `  ${C.hot(state.winner.handle)} ${C.bold('wins')} — ${state.winner.hours} hours`
      : `  ${C.rust('no winner')} — nobody cleared hour ${state.hour}`);
  }

  out.push('');
  const columns = Math.min(board.hours, 34);
  const from = board.hours - columns + 1;
  out.push(`  ${C.dim('hacker'.padEnd(13))}${C.dim(Array.from({ length: columns }, (_, i) => String((from + i) % 10)).join(''))} ${C.dim('hrs')}`);
  for (const row of board.rows) {
    const marks = row.marks.slice(from - 1).map((mark) =>
      mark === 'done' ? C.ink('█') :
      mark === 'running' ? C.hot('▚') :
      mark === 'dnf' ? C.rust('✕') : C.dim('·')).join('');
    const name = row.status === 'out' ? C.dim(row.handle) :
                 row.status === 'winner' ? C.hot(row.handle) : C.ink(row.handle);
    const pad = ' '.repeat(Math.max(0, 13 - row.handle.length));
    out.push(`  ${name}${pad}${marks} ${C.dim(String(row.marks.filter((m) => m === 'done').length))}`);
  }

  out.push('');
  out.push(...feed);
  out.push('');

  process.stdout.write('\x1b[2J\x1b[H' + out.join('\n'));
}

async function finish(workers) {
  const state = snapshot(app.race);
  console.log('');
  if (state.winner) {
    console.log(C.hot(`  ${state.winner.handle} is the last hacker standing after ${state.winner.hours} hours.`));
    console.log(C.dim(`  Everyone else is a DNF. That is the whole format.`));
  } else {
    console.log(C.rust(`  Nobody cleared hour ${state.hour}. No winner — that happens in real ultras too.`));
  }
  console.log('');
  setTimeout(async () => {
    for (const worker of workers) await worker.terminate();
    await app.close();
    process.exit(0);
  }, 800);
}
