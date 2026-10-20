// The Lists server: Google sign-in (ID token -> signed session cookie) and one private JSON document of lists per user.
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE = 'sid';
const GOOGLE_GSI = 'https://accounts.google.com/gsi/client';

// Only Google-hosted https avatars are accepted, so a session can never carry an arbitrary URL.
const safePicture = (url) => (/^https:\/\/[\w.-]+\.googleusercontent\.com\//.test(String(url || '')) && String(url).length < 400 ? String(url) : '');

const b64 = (buf) => Buffer.from(buf).toString('base64url');

// Session = base64url(json) + '.' + HMAC. Stateless, so nothing to store or expire server-side.
function sign(payload, secret) {
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(crypto.createHmac('sha256', secret).update(body).digest())}`;
}
function unsign(token, secret, now) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > now ? p : null;
  } catch { return null; }
}

function cookieOf(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// Keeps only the fields we know, with sane sizes; returns null if the shape is wrong.
const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);
function cleanLists(input) {
  if (!Array.isArray(input) || input.length > 500) return null;
  const out = [];
  for (const l of input) {
    if (!l || !Array.isArray(l.items) || l.items.length > 2000) return null;
    const id = str(l.id, 40), name = str(l.name, 80);
    if (!id || name === null) return null;
    const items = [];
    for (const i of l.items) {
      const iid = str(i && i.id, 40), text = str(i && i.text, 200);
      if (!iid || text === null || typeof i.done !== 'boolean') return null;
      items.push({ id: iid, text, done: i.done });
    }
    out.push({ id, name, items });
  }
  return out;
}

function createApp({ clientId, gsiSrc = GOOGLE_GSI, sessionSecret, verifyIdToken, store, now = Date.now }) {
  if (!sessionSecret) throw new Error('sessionSecret is required');
  const app = express();
  app.set('trust proxy', true); // behind Cloud Run / Cloudflare, so req.secure reflects the browser's HTTPS
  app.disable('x-powered-by');

  const keyOf = (sub) => `users/${crypto.createHash('sha256').update(sub).digest('hex')}.json`;

  app.use('/api', (req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); next(); });
  app.use('/api', express.json({ limit: '1mb' }));

  function setSession(req, res, user) {
    const token = sign({ ...user, exp: now() + SESSION_MS }, sessionSecret);
    res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_MS / 1000}; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`);
  }
  const clearSession = (req, res) => res.append('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`);

  function requireUser(req, res, next) {
    const user = unsign(cookieOf(req, COOKIE), sessionSecret, now());
    if (!user) return res.status(401).json({ error: 'Sign in required' });
    req.user = user;
    next();
  }

  app.get('/api/config', (req, res) => res.json({ clientId, gsiSrc }));

  app.post('/api/auth/google', async (req, res) => {
    try {
      const credential = req.body && req.body.credential;
      if (typeof credential !== 'string' || !credential) return res.status(400).json({ error: 'Missing credential' });
      const info = await verifyIdToken(credential);
      if (!info || !info.sub || !info.emailVerified) return res.status(401).json({ error: 'Google account could not be verified' });
      const user = { sub: String(info.sub), email: String(info.email || ''), name: String(info.name || info.email || ''), picture: safePicture(info.picture) };
      setSession(req, res, user);
      res.json({ user: { email: user.email, name: user.name, picture: user.picture } });
    } catch {
      res.status(401).json({ error: 'Google sign-in failed' });
    }
  });

  app.post('/api/auth/logout', (req, res) => { clearSession(req, res); res.json({ ok: true }); });

  app.get('/api/me', requireUser, (req, res) => res.json({ user: { email: req.user.email, name: req.user.name, picture: req.user.picture || '' } }));

  app.get('/api/lists', requireUser, async (req, res, next) => {
    try {
      const raw = await store.read(keyOf(req.user.sub));
      res.json(raw ? JSON.parse(raw) : { lists: [], updatedAt: 0 });
    } catch (err) { next(err); }
  });

  app.put('/api/lists', requireUser, async (req, res, next) => {
    try {
      const lists = cleanLists(req.body && req.body.lists);
      if (!lists) return res.status(400).json({ error: 'Invalid lists' });
      const doc = { lists, updatedAt: now() };
      await store.write(keyOf(req.user.sub), JSON.stringify(doc));
      res.json({ updatedAt: doc.updatedAt });
    } catch (err) { next(err); }
  });

  app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders(res, file) {
      if (path.basename(file) === 'sw.js') res.set('Cache-Control', 'no-cache');
    },
  }));

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Too much data' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad JSON' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });

  return app;
}

module.exports = { createApp, cleanLists };
