// Local preview with a fake Google: `node dev/dev-server.js` then open http://localhost:8099.
// The "Sign in" buttons below stand in for Google; nothing here is used in production.
const { createApp } = require('../api');
const { memoryStore } = require('../store');

const verifyIdToken = async (credential) => {
  const [sub, email] = credential.split('|');
  return { sub, email, emailVerified: true, name: email.split('@')[0], picture: sub === 'u1' ? 'https://lh3.googleusercontent.com/a/dev-photo' : undefined };
};

const app = createApp({ clientId: 'dev', gsiSrc: '/dev-gsi.js', sessionSecret: 'dev-secret', verifyIdToken, store: memoryStore() });

app.get('/dev-gsi.js', (req, res) => {
  res.type('js').send(`
    window.google = { accounts: { id: {
      initialize(o) { window.__cb = o.callback; },
      disableAutoSelect() {},
      renderButton(el) {
        for (const [label, cred] of [['Sign in as Ann (dev)', 'u1|ann@example.com'], ['Sign in as Bob (dev)', 'u2|bob@example.com']]) {
          const b = document.createElement('button');
          b.textContent = label; b.type = 'button';
          b.style.cssText = 'margin:4px;padding:10px 18px;border-radius:999px;background:#1a73e8;color:#fff;font-weight:600';
          b.onclick = () => window.__cb({ credential: cred });
          el.append(b);
        }
      },
    } } };`);
});

app.listen(8099, () => console.log('dev server on http://localhost:8099'));
