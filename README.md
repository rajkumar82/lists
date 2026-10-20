# Lists

A pad of simple checklists shown as cards: shopping list, things to discard, whatever. Add a list, name or
rename it, add items, tick them (ticked items are struck through), edit an item's text in place.
Not a todo app: no dates, no ratings, no sign-in.

Data lives in the browser's localStorage on each device (key `lists.v1`), so it is private and works offline,
but it is not synced between devices. Installable as a PWA. Node/Express just serves `public/`.

## Run locally

    npm install
    npm start          # http://localhost:8080

## Deploy to GCP (Cloud Run)

    gcloud run deploy lists --source . --region asia-south1 --allow-unauthenticated
