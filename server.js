const path = require('path');
const { createApp } = require('./api');
const { gcsStore, localStore } = require('./store');

const PORT = process.env.PORT || 8080;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID; // the OAuth "Web application" client id (public)
const SESSION_SECRET = process.env.SESSION_SECRET; // random string; signs the login cookie
const BUCKET = process.env.BUCKET; // if unset, lists are stored in ./data

if (!CLIENT_ID || !SESSION_SECRET) {
  console.error('GOOGLE_CLIENT_ID and SESSION_SECRET must be set');
  process.exit(1);
}

const { OAuth2Client } = require('google-auth-library');
const google = new OAuth2Client(CLIENT_ID);
async function verifyIdToken(idToken) {
  const ticket = await google.verifyIdToken({ idToken, audience: CLIENT_ID });
  const p = ticket.getPayload();
  return { sub: p.sub, email: p.email, emailVerified: p.email_verified === true, name: p.name, picture: p.picture };
}

const store = BUCKET ? gcsStore(BUCKET) : localStore(path.join(__dirname, 'data'));
createApp({ clientId: CLIENT_ID, sessionSecret: SESSION_SECRET, verifyIdToken, store })
  .listen(PORT, () => console.log(`Lists listening on ${PORT} (storage: ${BUCKET ? `gcs://${BUCKET}` : './data'})`));
