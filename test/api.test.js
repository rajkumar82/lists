const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../api');
const { memoryStore } = require('../store');

const PICTURES = { u1: 'https://lh3.googleusercontent.com/a/ann=s96-c', u2: 'https://evil.example.com/x.png' };

// A fake Google: the "credential" is just "<sub>|<email>|<verified>", so no network is needed.
const verifyIdToken = async (credential) => {
  const [sub, email, verified] = credential.split('|');
  if (!sub || sub === 'bad') throw new Error('invalid token');
  return { sub, email, emailVerified: verified !== 'unverified', name: email.split('@')[0], picture: PICTURES[sub] };
};

async function start(opts = {}) {
  const clock = { t: 1_000_000 };
  const app = createApp({ clientId: 'cid', sessionSecret: 'secret', verifyIdToken, store: memoryStore(), now: () => clock.t, ...opts });
  const server = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body, cookie } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, headers: res.headers };
  };
  const login = async (credential) => {
    const r = await call('POST', '/api/auth/google', { body: { credential } });
    const set = r.headers.get('set-cookie');
    return { r, cookie: set ? set.split(';')[0] : null };
  };
  return { call, login, clock, base, close: () => server.close() };
}

const sample = [{ id: 'a1', name: 'Shopping', items: [{ id: 'i1', text: 'Milk', done: false }, { id: 'i2', text: 'Eggs', done: true }] }];

test('config exposes the client id and the Google script URL', async () => {
  const s = await start();
  const r = await s.call('GET', '/api/config');
  assert.equal(r.json.clientId, 'cid');
  assert.match(r.json.gsiSrc, /accounts\.google\.com/);
  s.close();
});

test('lists API needs a signed-in user', async () => {
  const s = await start();
  assert.equal((await s.call('GET', '/api/lists')).status, 401);
  assert.equal((await s.call('PUT', '/api/lists', { body: { lists: [] } })).status, 401);
  assert.equal((await s.call('GET', '/api/me')).status, 401);
  s.close();
});

test('sign in sets an HttpOnly session cookie and /api/me knows the user', async () => {
  const s = await start();
  const { r, cookie } = await s.login('u1|ann@example.com');
  assert.equal(r.status, 200);
  assert.equal(r.json.user.email, 'ann@example.com');
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
  assert.match(r.headers.get('set-cookie'), /SameSite=Lax/);
  const me = await s.call('GET', '/api/me', { cookie });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, 'ann@example.com');
  s.close();
});

test('invalid or unverified Google tokens are rejected', async () => {
  const s = await start();
  assert.equal((await s.login('bad|x@example.com')).r.status, 401);
  assert.equal((await s.login('u1|ann@example.com|unverified')).r.status, 401);
  const none = await s.call('POST', '/api/auth/google', { body: {} });
  assert.equal(none.status, 400);
  s.close();
});

test('a user can save and read back their lists', async () => {
  const s = await start();
  const { cookie } = await s.login('u1|ann@example.com');
  assert.deepEqual((await s.call('GET', '/api/lists', { cookie })).json.lists, []);
  const put = await s.call('PUT', '/api/lists', { cookie, body: { lists: sample } });
  assert.equal(put.status, 200);
  const got = await s.call('GET', '/api/lists', { cookie });
  assert.deepEqual(got.json.lists, sample);
  assert.equal(got.json.updatedAt, put.json.updatedAt);
  s.close();
});

test('each user only sees their own lists', async () => {
  const s = await start();
  const ann = await s.login('u1|ann@example.com');
  const bob = await s.login('u2|bob@example.com');
  await s.call('PUT', '/api/lists', { cookie: ann.cookie, body: { lists: sample } });
  assert.deepEqual((await s.call('GET', '/api/lists', { cookie: bob.cookie })).json.lists, []);
  await s.call('PUT', '/api/lists', { cookie: bob.cookie, body: { lists: [{ id: 'b1', name: 'Bob', items: [] }] } });
  assert.deepEqual((await s.call('GET', '/api/lists', { cookie: ann.cookie })).json.lists, sample);
  s.close();
});

test('a tampered or forged cookie is rejected', async () => {
  const s = await start();
  const { cookie } = await s.login('u1|ann@example.com');
  const [name, value] = cookie.split('=');
  const [body, mac] = decodeURIComponent(value).split('.');
  const forgedBody = Buffer.from(JSON.stringify({ sub: 'u2', email: 'bob@example.com', name: 'bob', exp: 9e15 })).toString('base64url');
  assert.equal((await s.call('GET', '/api/me', { cookie: `${name}=${forgedBody}.${mac}` })).status, 401);
  assert.equal((await s.call('GET', '/api/me', { cookie: `${name}=${body}.AAAA` })).status, 401);
  assert.equal((await s.call('GET', '/api/me', { cookie: `${name}=garbage` })).status, 401);
  s.close();
});

test('the session expires after 30 days', async () => {
  const s = await start();
  const { cookie } = await s.login('u1|ann@example.com');
  s.clock.t += 29 * 86400e3;
  assert.equal((await s.call('GET', '/api/me', { cookie })).status, 200);
  s.clock.t += 2 * 86400e3;
  assert.equal((await s.call('GET', '/api/me', { cookie })).status, 401);
  s.close();
});

test('sign out clears the cookie', async () => {
  const s = await start();
  const { cookie } = await s.login('u1|ann@example.com');
  const out = await s.call('POST', '/api/auth/logout', { cookie });
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  s.close();
});

test('malformed list data is rejected and unknown fields are dropped', async () => {
  const s = await start();
  const { cookie } = await s.login('u1|ann@example.com');
  const bad = [
    { lists: 'nope' },
    { lists: [{ id: 'a', name: 'x' }] },
    { lists: [{ id: 'a', name: 'x', items: [{ id: 'i', text: 5, done: false }] }] },
    { lists: [{ id: 'a', name: 'x', items: [{ id: 'i', text: 't', done: 'yes' }] }] },
    { lists: [{ id: 'a', name: 'x'.repeat(81), items: [] }] },
  ];
  for (const body of bad) assert.equal((await s.call('PUT', '/api/lists', { cookie, body })).status, 400);
  await s.call('PUT', '/api/lists', { cookie, body: { lists: [{ id: 'a', name: 'x', extra: 1, items: [{ id: 'i', text: 't', done: false, evil: '<script>' }] }] } });
  const got = await s.call('GET', '/api/lists', { cookie });
  assert.deepEqual(got.json.lists, [{ id: 'a', name: 'x', items: [{ id: 'i', text: 't', done: false }] }]);
  s.close();
});

test('API responses are never cached', async () => {
  const s = await start();
  const { cookie } = await s.login('u1|ann@example.com');
  const r = await s.call('GET', '/api/lists', { cookie });
  assert.equal(r.headers.get('cache-control'), 'no-store');
  s.close();
});

test('the Secure flag is set when the request came in over HTTPS (behind the proxy)', async () => {
  const s = await start();
  const plain = await s.call('POST', '/api/auth/google', { body: { credential: 'u1|ann@example.com' } });
  assert.doesNotMatch(plain.headers.get('set-cookie'), /Secure/);
  const res = await fetch(s.base + '/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
    body: JSON.stringify({ credential: 'u1|ann@example.com' }),
  });
  assert.match(res.headers.get('set-cookie'), /; Secure/);
  s.close();
});

test('the profile photo is returned for Google-hosted images only', async () => {
  const s = await start();
  const ann = await s.login('u1|ann@example.com');
  assert.equal(ann.r.json.user.picture, 'https://lh3.googleusercontent.com/a/ann=s96-c');
  assert.equal((await s.call('GET', '/api/me', { cookie: ann.cookie })).json.user.picture, 'https://lh3.googleusercontent.com/a/ann=s96-c');
  const bob = await s.login('u2|bob@example.com');
  assert.equal(bob.r.json.user.picture, '');
  s.close();
});
