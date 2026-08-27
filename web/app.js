/* Last Hacker Ultra — the board.
   Polls the race twice a second's worth of state, runs the countdown locally so
   the clock never stutters, and repaints the tally when something changes. */

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'lhu.token';

const state = {
  race: null,
  challenge: null,
  me: null,
  token: readToken(),
  skewMs: 0,          // serverTime - Date.now(), so the clock agrees with the bell
  lastHour: null,
  lastBand: null,
};

function readToken() {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
}
function writeToken(value) {
  try { value ? localStorage.setItem(STORE_KEY, value) : localStorage.removeItem(STORE_KEY); } catch { /* private mode */ }
}

async function api(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (auth && state.token) headers.authorization = `Bearer ${state.token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const payload = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ...payload };
}

/* ------------------------------------------------------------------ clock -- */

const pad = (n) => String(n).padStart(2, '0');

function formatClock(ms) {
  if (ms == null) return '--:--';
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function paintClock() {
  const race = state.race;
  const clock = $('clock');
  if (!race || race.status !== 'running') {
    clock.textContent = race?.status === 'finished' ? 'done' : '--:--';
    clock.dataset.warning = 'false';
    $('drainFill').style.transform = 'scaleX(0)';
    $('drain').dataset.warning = 'false';
    return;
  }

  const now = Date.now() + state.skewMs;
  const left = Math.max(0, race.bellAt - now);
  const span = race.hourSeconds * 1000;
  clock.textContent = formatClock(left);

  // The last three minutes are called out loud at a real backyard ultra.
  const warning = left <= Math.min(180000, span * 0.1);
  clock.dataset.warning = String(warning);
  $('drain').dataset.warning = String(warning);
  $('drainFill').style.transform = `scaleX(${Math.min(1, left / span).toFixed(4)})`;
}

/* ------------------------------------------------------------------ render -- */

function paintRace(race) {
  const previousHour = state.lastHour;
  state.race = race;
  state.skewMs = race.serverTime - Date.now();

  document.documentElement.dataset.band = race.band ?? 'warmup';
  $('raceName').textContent = race.name;
  $('raceId').textContent = race.id;
  $('statusChip').textContent =
    race.status === 'signup' ? 'corral open' : race.status === 'running' ? 'running' : 'finished';
  $('statusChip').dataset.state = race.status;

  $('hourNum').textContent = race.hour || '—';
  $('bandLabel').textContent = race.bandLabel ?? 'CORRAL';
  $('statRunning').textContent = race.remaining;
  $('statOut').textContent = race.entrants - race.remaining;
  $('statDiff').textContent = race.difficulty ? `×${(race.difficulty / 100).toFixed(1)}` : '—';
  $('boardCount').textContent = `${race.entrants} entrant${race.entrants === 1 ? '' : 's'}`;

  $('bellNote').textContent = bellNote(race);
  paintTally(race);
  paintTicker(race.log ?? []);
  paintYou(race);

  if (previousHour !== null && race.hour !== previousHour) ringFlash();
  state.lastHour = race.hour;
}

function bellNote(race) {
  if (race.status === 'signup') {
    return race.startsAt
      ? `first bell at ${new Date(race.startsAt).toLocaleTimeString()}`
      : 'waiting for the first bell';
  }
  if (race.status === 'finished') {
    if (race.winner) return `${race.winner.handle} took it — ${race.winner.hours} hours`;
    if (race.outcome === 'no-finisher') return 'nobody cleared the last hour. no winner.';
    return 'race over';
  }
  const solved = race.standings.filter((s) => s.solvedCurrentHour).length;
  return `${solved} of ${race.remaining} already through hour ${race.hour}`;
}

function ringFlash() {
  document.body.dataset.ringing = 'true';
  setTimeout(() => { document.body.dataset.ringing = 'false'; }, 900);
}

function paintTally(race) {
  const host = $('tally');
  if (!race.standings.length) {
    host.innerHTML = '<p class="empty">Nobody has signed up yet.</p>';
    return;
  }
  const hours = race.hour || 0;
  // Older hours scroll off to the left; the last day of racing is what matters.
  const columns = Math.min(hours, 26);
  const from = hours - columns + 1;

  // Rule every fifth hour, like a paper tally sheet. Numbering all of them
  // makes each column as wide as its label and the board stops fitting.
  const head = ['<tr><th scope="col">Hacker</th>'];
  for (let h = from; h <= hours; h++) {
    const label = h % 5 === 0 || h === hours || h === from ? h : '';
    head.push(`<th scope="col" title="hour ${h}">${label}</th>`);
  }
  head.push('<th class="hours" scope="col">hrs</th></tr>');

  const rows = race.standings.map((s) => {
    const cells = [];
    for (let h = from; h <= hours; h++) cells.push(`<td class="cell"><i class="mark mark--${markFor(s, h, race)}"></i></td>`);
    return `<tr data-status="${s.status}">
      <td>${escapeHtml(s.handle)}${s.late ? ' <i class="hint">late</i>' : ''}</td>
      ${cells.join('')}
      <td class="hours">${s.hoursDone}</td>
    </tr>`;
  });

  host.innerHTML = `<table><thead>${head.join('')}</thead><tbody>${rows.join('')}</tbody></table>`;
}

function markFor(s, hour, race) {
  if (s.eliminatedHour && hour === s.eliminatedHour) return 'dnf';
  if (s.eliminatedHour && hour > s.eliminatedHour) return 'gone';
  if (hour <= s.hoursDone) return 'done';
  if (hour === race.hour && s.status === 'active') return s.solvedCurrentHour ? 'done' : 'running';
  return 'miss';
}

function paintTicker(log) {
  const host = $('ticker');
  if (!log.length) return;
  host.innerHTML = log.map((event) => {
    const when = new Date(event.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<li class="ticker__item" data-type="${event.type}"><span class="ticker__when">${when}</span><span>${describe(event)}</span></li>`;
  }).join('');
}

function describe(event) {
  const who = event.hacker ? `<strong>${escapeHtml(event.hacker)}</strong>` : '';
  switch (event.type) {
    case 'signup': return `${who} entered the corral`;
    case 'start': return `the first bell — ${event.starters} on the line`;
    case 'bell': return `hour ${event.hour} — ${event.remaining} still running`;
    case 'solve': return `${who} cleared hour ${event.hour} in ${formatClock(event.elapsedMs)}${event.place === 1 ? ' — first through' : ''}`;
    case 'dnf': return `${who} did not clear hour ${event.hour}`;
    case 'winner': return `${who} wins it. ${event.hours} hours.`;
    case 'no-winner': return 'nobody cleared the last hour. no winner.';
    default: return event.type;
  }
}

function paintYou(race) {
  const registered = Boolean(state.token && state.me);
  $('signupForm').hidden = registered;
  $('youCard').hidden = !registered;

  if (!registered) {
    $('youTitle').textContent = 'Enter the race';
    const closed = race.status === 'finished' || (race.status === 'running' && !race.lateEntry);
    $('youTag').textContent = race.status === 'finished' ? 'closed' : closed ? 'corral closed' : 'open';
    $('handleInput').disabled = closed;
    $('signupForm').querySelector('button').disabled = closed;
    if (closed && !$('signupResult').textContent) {
      setResult('signupResult', race.status === 'finished'
        ? 'This race is over. Watch the board, or start your own.'
        : 'The race is under way. You can only join before the first bell.', 'muted');
    }
    return;
  }

  const me = state.me;
  $('youTitle').textContent = 'Your run';
  $('youTag').textContent = me.status;
  $('youHandle').textContent = me.handle;
  $('youStatus').textContent =
    me.status === 'out' ? `out at hour ${me.eliminatedHour}` :
    me.status === 'winner' ? 'winner' :
    me.solvedCurrentHour ? 'through — waiting for the bell' : 'in the hour';
  $('youHours').textContent = me.hoursDone;
  $('youAttempts').textContent = me.attempts;
  $('youToken').textContent = state.token;
}

/* -------------------------------------------------------------- challenge -- */

function paintChallenge(challenge, race) {
  const canSubmit = Boolean(state.me && state.me.status === 'active' && race.status === 'running');
  $('answerForm').hidden = !canSubmit;

  if (!challenge) {
    $('challengeTitle').textContent = race.status === 'finished' ? 'Race over' : 'The corral';
    $('challengeDifficulty').textContent = race.status === 'finished' ? 'closed' : 'not started';
    $('challengeBlurb').textContent = race.status === 'finished'
      ? 'Every hour is readable at /api/hours/1 upwards, answers included.'
      : 'Sign-ups are open until the first bell.';
    $('challengeData').innerHTML = '';
    return;
  }

  $('challengeTitle').textContent = `Hour ${challenge.hour} — ${challenge.title}`;
  $('challengeDifficulty').textContent = `×${(challenge.difficulty / 100).toFixed(1)}`;
  $('challengeBlurb').textContent = challenge.blurb ?? challenge.familyName;
  $('challengeBrief').textContent = challenge.brief;
  $('answerFormat').textContent = challenge.answerFormat ? `— ${challenge.answerFormat}` : '';
  $('challengeFoot').textContent = 'GET /api/challenge · POST /api/submit {"answer": "..."}';

  const key = `${challenge.hour}:${challenge.family}`;
  if ($('challengeData').dataset.key === key) return;
  $('challengeData').dataset.key = key;
  $('challengeData').innerHTML = renderData(challenge.data ?? {});
  $('answerInput').value = '';
  setResult('answerResult', '', 'muted');
}

const BLOCK_KEYS = new Set(['ciphertext', 'payload', 'bytecode', 'redacted', 'digest', 'p', 'g', 'h', 'salt']);

function renderData(data) {
  const facts = [];
  const blocks = [];

  for (const [key, value] of Object.entries(data)) {
    if (key === 'isa') {
      blocks.push(
        `<details class="field" open><summary class="field__label"><span>instruction set</span><span>${value.length} opcodes</span></summary>` +
        `<pre class="field__value field__value--pre">${escapeHtml(value.join('\n'))}</pre></details>`,
      );
    } else if (key === 'numbers') {
      const items = value.map((n, i) => `<span><i>${i + 1}.</i> ${escapeHtml(n)}</span>`).join('');
      blocks.push(field(`${value.length} numbers`, `<div class="field__value numbers">${items}</div>`));
    } else if (Array.isArray(value)) {
      blocks.push(field(key, `<pre class="field__value">${escapeHtml(value.join('\n'))}</pre>`));
    } else if (BLOCK_KEYS.has(key) || String(value).length > 48) {
      blocks.push(field(key, `<pre class="field__value">${escapeHtml(String(value))}</pre>`, String(value)));
    } else {
      facts.push(`<li>${escapeHtml(key)} <b>${escapeHtml(String(value))}</b></li>`);
    }
  }

  const factList = facts.length ? `<ul class="facts">${facts.join('')}</ul>` : '';
  return factList + blocks.join('');
}

function field(label, html, copyable) {
  const bytes = copyable ? `<span>${copyable.length} chars</span>` : '';
  return `<div class="field"><p class="field__label"><span>${escapeHtml(label)}</span>${bytes}</p>${html}</div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setResult(id, text, tone = 'muted') {
  const el = $(id);
  el.textContent = text;
  el.dataset.tone = tone;
}

/* --------------------------------------------------------------- polling -- */

async function refresh() {
  const race = await api('/api/state');
  if (!race.ok) return;
  paintRace(race);

  if (state.token) {
    const me = await api('/api/me', { auth: true });
    state.me = me.ok ? me : null;
    if (!me.ok && me.status === 401) { state.token = null; writeToken(null); }
    paintYou(race);
  }

  if (race.status === 'running') {
    const challenge = await api('/api/challenge');
    paintChallenge(challenge.ok ? challenge : null, race);
  } else {
    paintChallenge(null, race);
  }
}

/* ---------------------------------------------------------------- events -- */

$('signupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const handle = $('handleInput').value.trim();
  if (!handle) return setResult('signupResult', 'Pick a handle first.', 'bad');

  const result = await api('/api/signup', { method: 'POST', body: { handle } });
  if (!result.ok) return setResult('signupResult', result.error ?? 'Signup failed.', 'bad');

  state.token = result.token;
  writeToken(result.token);
  setResult('signupResult', result.message, 'good');
  await refresh();
});

$('answerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const answer = $('answerInput').value.trim();
  if (!answer) return setResult('answerResult', 'Nothing to submit.', 'bad');

  $('answerSubmit').disabled = true;
  const result = await api('/api/submit', { method: 'POST', body: { answer }, auth: true });
  $('answerSubmit').disabled = false;

  if (!result.ok) {
    setResult('answerResult', result.error ?? 'Submission failed.', 'bad');
  } else if (result.correct) {
    const place = result.place === 1 ? ' First through this hour.' : result.place ? ` Number ${result.place} through.` : '';
    setResult('answerResult', `Through hour ${result.hour} in ${formatClock(result.elapsedMs)}.${place}`, 'good');
    $('answerInput').value = '';
  } else {
    setResult('answerResult', 'Rejected. The clock is still running.', 'bad');
  }
  await refresh();
});

$('forgetBtn').addEventListener('click', () => {
  state.token = null;
  state.me = null;
  writeToken(null);
  setResult('signupResult', 'Token cleared from this browser.', 'muted');
  refresh();
});

setInterval(paintClock, 100);
setInterval(refresh, 2000);
refresh();
