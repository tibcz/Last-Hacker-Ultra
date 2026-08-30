import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Store } from '../core/store.js';
import { safeEqual, token } from '../core/util.js';
import {
  createRace, signup, authenticate, startRace, tick, submit,
  snapshot, tally, currentChallenge, archivedHour, activeHackers,
} from '../core/race.js';
import { json, readJsonBody, bearer, clientIp, serveStatic, RateLimiter } from './http.js';

const here = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(here, '..', '..', 'web');

const env = (key, fallback) => process.env[key] ?? fallback;
const PORT = Number(env('LHU_PORT', 3000));
const HOST = env('LHU_HOST', '127.0.0.1');
const DATA_FILE = env('LHU_DATA', join(here, '..', '..', 'data', 'race.json'));
const HOUR_SECONDS = Number(env('LHU_HOUR_SECONDS', 3600));
const ADMIN_TOKEN = env('LHU_ADMIN_TOKEN', token(16));
const ADMIN_TOKEN_GENERATED = !process.env.LHU_ADMIN_TOKEN;
const TRUST_PROXY = env('LHU_TRUST_PROXY', '') === '1';

export function createRaceServer({
  dataFile = DATA_FILE,
  hourSeconds = HOUR_SECONDS,
  adminToken = ADMIN_TOKEN,
  raceName = env('LHU_RACE_NAME', 'Last Hacker Ultra'),
  seed = env('LHU_SEED', undefined),
  lateEntry = env('LHU_LATE_ENTRY', '') === '1',
  trustProxy = TRUST_PROXY,
  persist = true,
} = {}) {
  const store = persist ? new Store(dataFile) : null;
  let race = store?.load() ?? createRace({
    name: raceName,
    seed,
    config: { hourSeconds, lateEntry },
  });

  const signupLimit = new RateLimiter(8, 60 * 60 * 1000);
  const submitLimit = new RateLimiter(600, 60 * 60 * 1000);
  const save = () => store?.save(race);

  const advance = () => {
    const events = tick(race);
    if (events.length) save();
    return events;
  };

  const isAdmin = (req) => {
    const supplied = bearer(req) ?? req.headers['x-admin-token'];
    return Boolean(supplied) && safeEqual(supplied, adminToken);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method ?? 'GET';

    res.setHeader('x-race', race.id);
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
      }).end();
      return;
    }
    if (path.startsWith('/api/')) res.setHeader('access-control-allow-origin', '*');

    try {
      if (await route(req, res, { path, method, url })) return;
    } catch (err) {
      console.error('[server]', err);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      return;
    }

    if (method === 'GET' && !path.startsWith('/api/')) {
      if (await serveStatic(res, WEB_ROOT, path)) return;
      if (await serveStatic(res, WEB_ROOT, '/index.html')) return;
    }
    json(res, 404, { error: 'not found' });
  });

  async function route(req, res, { path, method, url }) {
    /* ------------------------------------------------------------- public -- */

    if (method === 'GET' && path === '/api/state') {
      advance();
      json(res, 200, snapshot(race));
      return true;
    }

    if (method === 'GET' && path === '/api/tally') {
      advance();
      json(res, 200, tally(race));
      return true;
    }

    if (method === 'GET' && path === '/api/challenge') {
      advance();
      const challenge = currentChallenge(race);
      if (!challenge) {
        json(res, 409, { error: race.status === 'signup' ? 'the race has not started' : 'the race is over' });
        return true;
      }
      json(res, 200, { ...challenge, msToBell: snapshot(race).msToBell });
      return true;
    }

    const hourMatch = /^\/api\/hours\/(\d+)$/.exec(path);
    if (method === 'GET' && hourMatch) {
      advance();
      const archived = archivedHour(race, Number(hourMatch[1]));
      if (!archived) { json(res, 404, { error: 'that hour has not closed yet' }); return true; }
      json(res, 200, archived);
      return true;
    }

    /* ------------------------------------------------------------ hackers -- */

    if (method === 'POST' && path === '/api/signup') {
      advance();
      const gate = signupLimit.take(clientIp(req, trustProxy));
      if (!gate.ok) {
        json(res, 429, { error: 'too many signups from this address', retryAfterMs: gate.retryAfterMs });
        return true;
      }
      const body = await readJsonBody(req);
      if (body.error) { json(res, 400, { error: body.error }); return true; }

      const result = signup(race, body.value.handle);
      if (result.error) { json(res, 400, { error: result.error }); return true; }
      save();
      json(res, 201, {
        id: result.hacker.id,
        handle: result.hacker.handle,
        token: result.token,
        late: result.hacker.late,
        message: race.status === 'running'
          ? `you are in, mid-race, from hour ${race.hour}`
          : 'you are in the corral. keep this token — it is the only copy.',
      });
      return true;
    }

    if (method === 'GET' && path === '/api/me') {
      advance();
      const hacker = authenticate(race, bearer(req));
      if (!hacker) { json(res, 401, { error: 'unknown token' }); return true; }
      json(res, 200, {
        id: hacker.id,
        handle: hacker.handle,
        status: hacker.status,
        hoursDone: hacker.hoursDone,
        eliminatedHour: hacker.eliminatedHour,
        attempts: hacker.attempts,
        solvedCurrentHour: Boolean(hacker.solved[race.hour]),
        hour: race.hour,
      });
      return true;
    }

    if (method === 'POST' && path === '/api/submit') {
      advance();
      const hacker = authenticate(race, bearer(req));
      if (!hacker) { json(res, 401, { error: 'unknown token' }); return true; }

      const gate = submitLimit.take(hacker.id);
      if (!gate.ok) {
        json(res, 429, { error: 'submission cap reached for this hour', retryAfterMs: gate.retryAfterMs });
        return true;
      }
      const body = await readJsonBody(req);
      if (body.error) { json(res, 400, { error: body.error }); return true; }

      const result = submit(race, hacker, body.value.answer);
      save();
      if (result.error) { json(res, result.retryAfterMs ? 429 : 409, result); return true; }
      json(res, 200, { ...result, hour: race.hour, remaining: activeHackers(race).length });
      return true;
    }

    /* -------------------------------------------------------------- admin -- */

    if (path.startsWith('/api/admin/')) {
      if (!isAdmin(req)) { json(res, 401, { error: 'admin token required' }); return true; }

      if (method === 'POST' && path === '/api/admin/start') {
        advance();
        const result = startRace(race);
        if (result.error) { json(res, 409, result); return true; }
        save();
        json(res, 200, snapshot(race));
        return true;
      }

      if (method === 'POST' && path === '/api/admin/new') {
        const body = await readJsonBody(req);
        if (body.error) { json(res, 400, { error: body.error }); return true; }
        if (race.status !== 'signup' || Object.keys(race.hackers).length) store?.archive(race);
        const cfg = body.value ?? {};
        race = createRace({
          name: cfg.name ?? raceName,
          seed: cfg.seed,
          startsAt: cfg.startsAt ?? null,
          config: {
            hourSeconds: Number(cfg.hourSeconds ?? hourSeconds),
            lateEntry: Boolean(cfg.lateEntry ?? lateEntry),
            maxHours: Number(cfg.maxHours ?? 0),
          },
        });
        save();
        json(res, 201, snapshot(race));
        return true;
      }

      // Ring the bell early. Demo and testing only — a real ultra runs on the clock.
      if (method === 'POST' && path === '/api/admin/bell') {
        if (race.status !== 'running') { json(res, 409, { error: 'race is not running' }); return true; }
        race.startedAt -= Math.max(0, snapshot(race).msToBell) + 1;
        advance();
        save();
        json(res, 200, snapshot(race));
        return true;
      }
      return false;
    }

    return false;
  }

  const heartbeat = setInterval(() => {
    advance();
    signupLimit.sweep();
    submitLimit.sweep();
  }, 1000);
  heartbeat.unref?.();

  server.on('close', () => {
    clearInterval(heartbeat);
    store?.flush();
  });

  return {
    server,
    get race() { return race; },
    adminToken,
    close: () => new Promise((resolve) => { store?.flush(); server.close(resolve); }),
  };
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = createRaceServer();
  app.server.listen(PORT, HOST, () => {
    const hours = app.race.config.hourSeconds;
    console.log(`\n  ▚▚ LAST HACKER ULTRA ▚▚`);
    console.log(`  the loop is one hour long. it never gets shorter.\n`);
    console.log(`  board      http://localhost:${PORT}`);
    console.log(`  race       ${app.race.name} [${app.race.id}] — ${app.race.status}`);
    console.log(`  hour       ${hours}s${hours !== 3600 ? '  (compressed)' : ''}`);
    if (ADMIN_TOKEN_GENERATED) console.log(`  admin      ${app.adminToken}   (set LHU_ADMIN_TOKEN to pin it)`);
    console.log(`\n  start it:  curl -XPOST localhost:${PORT}/api/admin/start -H "authorization: Bearer ${app.adminToken}"\n`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => { await app.close(); process.exit(0); });
  }
}
