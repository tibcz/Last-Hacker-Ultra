import test from 'node:test';
import assert from 'node:assert/strict';

import { createRaceServer } from '../src/server/server.js';
import { generateChallenge } from '../src/core/challenges/index.js';
import { sha256, leadingZeroBits } from '../src/core/util.js';

const ADMIN = 'test-admin-token';

async function withServer(run, options = {}) {
  const app = createRaceServer({ hourSeconds: 30, persist: false, adminToken: ADMIN, seed: 'http-test', ...options });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const call = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    await run({ app, base, call });
  } finally {
    await app.close();
  }
}

const answerFor = (challenge) => {
  const full = generateChallenge('http-test', challenge.hour);
  if (full.answer !== null && full.answer !== undefined) return full.answer;
  for (let n = 0; n < 20_000_000; n++) {
    const nonce = n.toString(36);
    if (leadingZeroBits(sha256(full.prefix + nonce)) >= full.target) return nonce;
  }
  throw new Error('could not mine');
};

test('a hacker can sign up, read the hour and clear it', async () => {
  await withServer(async ({ call }) => {
    const entry = await call('/api/signup', { method: 'POST', body: { handle: 'ada' } });
    assert.equal(entry.status, 201);
    assert.ok(entry.body.token);
    assert.equal(entry.body.handle, 'ada');

    await call('/api/signup', { method: 'POST', body: { handle: 'turing' } });

    const early = await call('/api/challenge');
    assert.equal(early.status, 409, 'no challenge before the first bell');

    const started = await call('/api/admin/start', { method: 'POST', token: ADMIN });
    assert.equal(started.status, 200);
    assert.equal(started.body.hour, 1);

    const challenge = await call('/api/challenge');
    assert.equal(challenge.status, 200);
    assert.equal(challenge.body.hour, 1);
    assert.equal(challenge.body.answer, undefined);
    assert.ok(challenge.body.brief);
    assert.ok(challenge.body.msToBell > 0);

    const wrong = await call('/api/submit', { method: 'POST', body: { answer: 'nope' }, token: entry.body.token });
    assert.equal(wrong.status, 200);
    assert.equal(wrong.body.correct, false);

    await new Promise((r) => setTimeout(r, 1600)); // clear the cooldown
    const right = await call('/api/submit', {
      method: 'POST', body: { answer: answerFor(challenge.body) }, token: entry.body.token,
    });
    assert.equal(right.body.correct, true);
    assert.equal(right.body.place, 1);

    const me = await call('/api/me', { token: entry.body.token });
    assert.equal(me.body.solvedCurrentHour, true);
    assert.equal(me.body.attempts, 2);
  });
});

test('signup rejects bad and duplicate handles', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('/api/signup', { method: 'POST', body: { handle: 'ada' } })).status, 201);
    const dupe = await call('/api/signup', { method: 'POST', body: { handle: 'ada' } });
    assert.equal(dupe.status, 400);
    assert.match(dupe.body.error, /already in the corral/);

    const bad = await call('/api/signup', { method: 'POST', body: { handle: 'no spaces' } });
    assert.equal(bad.status, 400);

    const missing = await call('/api/signup', { method: 'POST', body: {} });
    assert.equal(missing.status, 400);
  });
});

test('submitting and reading yourself need a real token', async () => {
  await withServer(async ({ call }) => {
    for (const token of [undefined, 'bogus', '']) {
      assert.equal((await call('/api/me', { token })).status, 401);
      assert.equal((await call('/api/submit', { method: 'POST', body: { answer: 'x' }, token })).status, 401);
    }
  });
});

test('admin routes need the admin token', async () => {
  await withServer(async ({ call }) => {
    for (const token of [undefined, 'wrong', 'test-admin-toke', 'test-admin-tokenn']) {
      const res = await call('/api/admin/start', { method: 'POST', token });
      assert.equal(res.status, 401, `token ${JSON.stringify(token)} should not be admin`);
    }
    assert.equal((await call('/api/admin/start', { method: 'POST', token: ADMIN })).status, 200);
  });
});

test('a closed hour opens its archive, a live one does not', async () => {
  await withServer(async ({ call }) => {
    await call('/api/signup', { method: 'POST', body: { handle: 'ada' } });
    await call('/api/signup', { method: 'POST', body: { handle: 'turing' } });
    await call('/api/admin/start', { method: 'POST', token: ADMIN });

    assert.equal((await call('/api/hours/1')).status, 404, 'the live hour stays sealed');
    await call('/api/admin/bell', { method: 'POST', token: ADMIN });

    const archived = await call('/api/hours/1');
    assert.equal(archived.status, 200);
    assert.ok(archived.body.answer);
    assert.deepEqual(archived.body.result.dnf.sort(), ['ada', 'turing']);
    assert.equal((await call('/api/hours/99')).status, 404);
    assert.equal((await call('/api/hours/abc')).status, 404);
  });
});

test('the board and the tally are readable by anyone', async () => {
  await withServer(async ({ call }) => {
    const state = await call('/api/state');
    assert.equal(state.status, 200);
    assert.equal(state.body.status, 'signup');
    assert.deepEqual(state.body.standings, []);

    const board = await call('/api/tally');
    assert.equal(board.status, 200);
    assert.deepEqual(board.body.rows, []);
  });
});

test('the page itself is served, and unknown API routes 404', async () => {
  await withServer(async ({ base, call }) => {
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /Last Hacker Ultra/);

    assert.equal((await fetch(base + '/style.css')).status, 200);
    assert.equal((await call('/api/nope')).status, 404);
  });
});

test('path traversal cannot escape the web root', async () => {
  await withServer(async ({ base }) => {
    for (const path of ['/../package.json', '/..%2Fpackage.json', '/../../etc/passwd', '/%2e%2e/package.json']) {
      const res = await fetch(base + path);
      const body = await res.text();
      assert.ok(!body.includes('"name": "last-hacker-ultra"'), `${path} escaped the web root`);
      assert.ok(!body.includes('root:'), `${path} escaped the web root`);
    }
  });
});

test('an oversized body is refused', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(base + '/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'x'.repeat(64 * 1024) }),
    }).catch(() => ({ status: 400 }));
    assert.ok(res.status >= 400, 'a huge body must not be accepted');
  });
});

test('malformed JSON is a 400, not a crash', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(base + '/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    assert.equal(res.status, 400);
  });
});

/*
 * The signup limiter is the only per-address control there is, so the header
 * that names the address has to be worth something. Anyone can set
 * x-forwarded-for; only a proxy we were told about gets believed.
 */
test('a spoofed x-forwarded-for cannot refill the signup limit', async () => {
  await withServer(async ({ call }) => {
    const codes = [];
    for (let i = 0; i < 11; i++) {
      const res = await call('/api/signup', {
        method: 'POST',
        body: { handle: `spoof${i}` },
        headers: { 'x-forwarded-for': `10.0.0.${i}` },
      });
      codes.push(res.status);
    }
    assert.equal(codes.filter((c) => c === 201).length, 8, 'the limiter must cap at 8 regardless of the header');
    assert.ok(codes.includes(429), 'the eventual answer must be 429');
  });
});

test('x-forwarded-for is honoured once an operator vouches for the proxy', async () => {
  await withServer(async ({ call }) => {
    const codes = [];
    for (let i = 0; i < 11; i++) {
      const res = await call('/api/signup', {
        method: 'POST',
        body: { handle: `proxied${i}` },
        headers: { 'x-forwarded-for': `10.0.0.${i}` },
      });
      codes.push(res.status);
    }
    assert.ok(!codes.includes(429), 'distinct forwarded addresses are distinct buckets when trusted');
  }, { trustProxy: true });
});
