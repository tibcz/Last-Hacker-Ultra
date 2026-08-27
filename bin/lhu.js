#!/usr/bin/env node
/**
 * lhu — play Last Hacker Ultra from a terminal.
 *
 *   lhu watch                 the board, live
 *   lhu signup <handle>       take a bib
 *   lhu hour                  print this hour's challenge
 *   lhu solve                 fetch it, solve it, submit it
 *   lhu submit <answer>       submit something you worked out yourself
 *   lhu me                    where you stand
 *
 * Point it somewhere else with --server https://race.example, or LHU_SERVER.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const CRED_FILE = join(homedir(), '.config', 'lhu', 'credentials.json');

const argv = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') === false ? argv[++i] : true;
  else args.push(argv[i]);
}
const BASE = String(flags.server ?? process.env.LHU_SERVER ?? 'http://localhost:3000').replace(/\/$/, '');

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  hot: (s) => `\x1b[38;5;208m${s}\x1b[0m`,
  rust: (s) => `\x1b[38;5;167m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function credentials() {
  try { return JSON.parse(readFileSync(CRED_FILE, 'utf8')); } catch { return {}; }
}
function saveCredential(entry) {
  const all = credentials();
  all[BASE] = entry;
  mkdirSync(dirname(CRED_FILE), { recursive: true });
  writeFileSync(CRED_FILE, JSON.stringify(all, null, 2), { mode: 0o600 });
}
const tokenFor = () => process.env.LHU_TOKEN ?? credentials()[BASE]?.token ?? null;

async function api(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (auth) {
    const token = tokenFor();
    if (!token) fail(`no token for ${BASE} — run: lhu signup <handle>`);
    headers.authorization = `Bearer ${token}`;
  }
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (err) {
    fail(`cannot reach ${BASE} — ${err.message}`);
  }
  const payload = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ...payload };
}

function fail(message) {
  console.error(c.rust(`  ${message}`));
  process.exit(1);
}

const clock = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

/* ------------------------------------------------------------- commands -- */

const commands = {
  async watch() {
    const paint = async () => {
      const race = await api('/api/state');
      if (!race.ok) fail(race.error ?? 'no race');
      const lines = [''];
      lines.push(`  ${c.bold(race.name)}  ${c.dim(race.id)}`);
      lines.push('');
      if (race.status === 'running') {
        lines.push(`  hour ${c.bold(String(race.hour))}  ${c.hot(race.bandLabel)}  difficulty ${c.hot('×' + (race.difficulty / 100).toFixed(1))}`);
        lines.push(`  next bell in ${c.bold(clock(race.msToBell))}`);
      } else if (race.status === 'signup') {
        lines.push(`  ${c.hot('corral open')} — ${race.entrants} signed up, waiting for the first bell`);
      } else {
        lines.push(race.winner
          ? `  ${c.hot(race.winner.handle)} won it — ${race.winner.hours} hours`
          : `  ${c.rust('no winner')} — nobody cleared hour ${race.hour}`);
      }
      lines.push('');
      for (const row of race.standings.slice(0, 30)) {
        const mark = row.status === 'active' ? (row.solvedCurrentHour ? c.hot('▚') : c.dim('·'))
          : row.status === 'winner' ? c.hot('★') : c.rust('✕');
        const name = row.status === 'out' ? c.dim(row.handle) : row.handle;
        lines.push(`  ${mark} ${name.padEnd(24)} ${String(row.hoursDone).padStart(3)}h${row.eliminatedHour ? c.dim(`  out at ${row.eliminatedHour}`) : ''}`);
      }
      lines.push('');
      process.stdout.write('\x1b[2J\x1b[H' + lines.join('\n'));
      return race.status !== 'finished';
    };
    while (await paint()) await new Promise((r) => setTimeout(r, 1000));
  },

  async signup(handle) {
    if (!handle) fail('usage: lhu signup <handle>');
    const result = await api('/api/signup', { method: 'POST', body: { handle } });
    if (!result.ok) fail(result.error);
    saveCredential({ handle: result.handle, token: result.token, id: result.id });
    console.log(c.hot(`  you are in as ${result.handle}`));
    console.log(c.dim(`  token saved to ${CRED_FILE}`));
  },

  async hour() {
    const challenge = await api('/api/challenge');
    if (!challenge.ok) fail(challenge.error);
    if (flags.json) { console.log(JSON.stringify(challenge, null, 2)); return; }
    console.log('');
    console.log(`  ${c.bold(`HOUR ${challenge.hour} — ${challenge.title}`)}  ${c.dim(challenge.familyName)}`);
    console.log(`  ${c.hot(`difficulty ×${(challenge.difficulty / 100).toFixed(1)}`)}  ${c.dim(`bell in ${clock(challenge.msToBell)}`)}`);
    console.log('');
    console.log(wrap(challenge.brief, 76, '  '));
    console.log('');
    for (const [key, value] of Object.entries(challenge.data)) {
      const rendered = Array.isArray(value) ? value.join('\n    ') : String(value);
      console.log(`  ${c.dim(key)}`);
      console.log(`    ${rendered.length > 2000 ? rendered.slice(0, 2000) + c.dim(' …') : rendered}`);
    }
    console.log('');
    console.log(c.dim(`  answer: ${challenge.answerFormat}`));
    console.log(c.dim(`  submit: lhu submit '<answer>'`));
    console.log('');
  },

  async solve() {
    const { solve } = await import('../tools/solver.js');
    const challenge = await api('/api/challenge');
    if (!challenge.ok) fail(challenge.error);

    const budgetMs = Math.min(
      Number(flags.budget ?? 0) * 1000 || challenge.msToBell - 2000,
      challenge.msToBell - 1000,
    );
    console.log(c.dim(`  hour ${challenge.hour} · ${challenge.familyName} · ${Math.round(budgetMs / 1000)}s of budget`));
    const started = Date.now();
    const answer = solve(challenge, { budgetMs });
    const spent = ((Date.now() - started) / 1000).toFixed(1);

    if (answer === null) {
      console.log(c.rust(`  no answer after ${spent}s. this one is yours to figure out.`));
      process.exit(2);
    }
    console.log(c.hot(`  answer after ${spent}s: ${answer.length > 60 ? answer.slice(0, 60) + '…' : answer}`));
    if (flags['dry-run']) return;
    await commands.submit(answer);
  },

  async submit(answer) {
    if (!answer) fail('usage: lhu submit <answer>');
    const result = await api('/api/submit', { method: 'POST', body: { answer }, auth: true });
    if (!result.ok) fail(result.error);
    if (result.correct) {
      console.log(c.hot(`  through hour ${result.hour}${result.place ? ` — number ${result.place}` : ''}. ${result.remaining} still running.`));
    } else {
      console.log(c.rust('  rejected. clock is still going.'));
      process.exit(2);
    }
  },

  async me() {
    const me = await api('/api/me', { auth: true });
    if (!me.ok) fail(me.error);
    console.log('');
    console.log(`  ${c.bold(me.handle)}  ${me.status === 'out' ? c.rust(`out at hour ${me.eliminatedHour}`) : c.hot(me.status)}`);
    console.log(`  ${me.hoursDone} hours cleared · ${me.attempts} attempts · hour ${me.hour} is ${me.solvedCurrentHour ? c.hot('done') : c.dim('open')}`);
    console.log('');
  },

  async help() {
    console.log(`
  ${c.bold('lhu')} — Last Hacker Ultra ${c.dim(BASE)}

    ${c.hot('lhu watch')}                the board, live
    ${c.hot('lhu signup')} <handle>      take a bib
    ${c.hot('lhu hour')} [--json]        this hour's challenge
    ${c.hot('lhu solve')} [--budget 60]  fetch, solve, submit
    ${c.hot('lhu submit')} <answer>      submit your own answer
    ${c.hot('lhu me')}                   where you stand

  ${c.dim('--server URL   point at another race (or set LHU_SERVER)')}
  ${c.dim('--dry-run      solve but do not submit')}
`);
  },
};

function wrap(text, width, indent = '') {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = indent;
  for (const word of words) {
    if (line.length + word.length + 1 > width && line.trim()) { lines.push(line); line = indent; }
    line += (line === indent ? '' : ' ') + word;
  }
  if (line.trim()) lines.push(line);
  return lines.join('\n');
}

const command = args[0] ?? 'help';
const handler = commands[command];
if (!handler) {
  console.error(c.rust(`  unknown command: ${command}`));
  await commands.help();
  process.exit(1);
}
await handler(...args.slice(1));
