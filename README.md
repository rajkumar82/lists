# Lists

A pad of simple checklists shown as cards: shopping list, things to discard, whatever. Add a list, name or
rename it, add items, tick them (ticked items are struck through), edit an item's text in place.
Not a todo app: no dates, no ratings.

Sign in with Google; each person has their own private set of lists, stored on the server (one JSON file per
account in a Cloud Storage bucket) and cached in the browser (`lists.v2.<email>`) so it opens instantly and works
offline. Edits made offline are pushed when the connection returns, and changes from another device appear when
the app comes back to the front. Last write wins if two devices edit at the same time. Installable as a PWA.

Server: `api.js` (Express app: Google ID-token check, signed session cookie, `GET/PUT /api/lists`), `store.js`
(GCS / local / memory storage), `server.js` (wiring). The login cookie is HttpOnly, SameSite=Lax and signed with
`SESSION_SECRET`; the service worker never caches `/api/`.

Environment: `GOOGLE_CLIENT_ID` (OAuth "Web application" client id, public), `SESSION_SECRET` (random, keep secret),
`BUCKET` (if unset, lists are written under `./data`).

## Run locally

    npm install
    npm test                       # server tests (fake Google, in-memory storage)
    node dev/dev-server.js        # http://localhost:8099 with fake "Sign in as Ann/Bob" buttons instead of Google

## Deploy to GCP (Cloud Run)

    gcloud run deploy lists --source . --region asia-south1 --allow-unauthenticated
