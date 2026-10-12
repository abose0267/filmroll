# FilmRoll

*Different lives. One roll of film.*

FilmRoll is a mobile-first web app (installable PWA) that gives long-distance friends a shared disposable camera. A group loads a roll of 12, 24 or 36 exposures. Everyone adds moments from their own life, but **nobody can see the photos, including the person who took them, until the roll develops**. When the roll fills up or its date arrives, everyone's photos are revealed together as a film album.

## Stack

- **Web app:** React 19, TypeScript, Vite, Tailwind CSS 4, React Router 7, Motion; a PWA via `vite-plugin-pwa`.
- **Backend:** Firebase Auth (Google + email/password), Firestore, Storage, Cloud Functions v2 (Node 22).
- **Film effects:** pure pixel code in `shared/presets.ts`, run in a Web Worker. No AI APIs or external image services are used.

```
shared/            Typed models + pure logic used by app AND functions (unit-tested)
  types.ts         Firestore document shapes
  rolls.ts         Roll state machine, exposure accounting, development conditions
  presets.ts       Film presets (tone curve, white balance, grain, vignette, leaks, flash)
  validation.ts    Invite codes, file signature sniffing, text cleaning
  memories.ts      Anniversary / "first roll" resurfacing
functions/src/     Cloud Functions (all trusted writes)
src/               React app (pages/, components/, hooks/, lib/)
tests/rules/       Firestore + Storage security rule tests (emulator)
scripts/           e2e.ts (backend), browser-e2e.mjs (mobile UI), make-icons.mjs
```

## How the hidden-photo mechanic is enforced

Photos aren't hidden with CSS. Before a roll develops, neither Firestore nor Storage will hand them to anyone.

| Data | Where | Who can read it |
|---|---|---|
| Roll metadata (name, capacity, counts, who has shot, status, dates) | `groups/{g}/rolls/{r}` | group members |
| Photo records (caption, location, storage paths) | `…/rolls/{r}/photos/{p}` | members, **only once `status == 'developed'`** (Firestore rules) |
| Upload staging files | Storage `uploads/{uid}/{reservation}/…` | nobody (owner can write only) |
| Photo files | Storage `photos/{g}/{r}/{p}/…` | nobody directly |
| Reservations, invite codes, rate limits | server-only collections | nobody |

Developed photos are served by the `photo` HTTPS function. On every request it checks the caller's ID token, group membership, the group's history setting and that the roll is developed. **No Firebase download URLs exist for roll photos**, so no long-lived link can leak. Responses carry `Cache-Control: private` and are kept in memory as object URLs. The service worker never caches them.

The uploader gets confirmation and an updated exposure count, but can't reopen their photo before development.

### Exposure accounting

1. `reserveExposure` runs a transaction that takes a slot only if `used + liveReservations < capacity`. It is idempotent per client request ID, and each person can hold at most 2 pending reservations.
2. The client uploads `original` (≤4096px; re-encoded, which strips EXIF/GPS), `display` (film-processed, ≤2048px) and `thumb` (≤480px).
3. `finalizeExposure` checks the files: size, MIME type, and file signature (magic bytes). It moves them into the private area, then a transaction turns the reservation into a used exposure with a frame number. Calling it again for the same reservation returns the same result.
4. Reservations expire after 15 minutes. The scheduled `sweepRolls` (every 5 minutes) frees their slots and deletes abandoned uploads, so a failed upload never uses up an exposure.

### Roll states

`active → developing → developed` (plus `active → cancelled`, allowed only for rolls with no shots). Only backend code changes a roll's state, and the transition table is in `shared/rolls.ts`.

- **Full** (develop-when-full or whichever-first mode): the last finalization develops the roll immediately.
- **Date reached:** the sweeper develops the roll. If uploads are still in flight it first moves to `developing`, waits for them (up to 15 minutes), then reveals. No user needs to be online. All times are stored as UTC milliseconds and shown in each viewer's local time zone.

### Edge cases

| Case | What happens |
|---|---|
| Two people take the last shot at the same time | The reservation transaction lets exactly one through; the other is told the roll is full. |
| Upload fails or the connection drops | Retries reuse the same reservation; if it expires, the slot goes back to the group. |
| Upload succeeds but finalization fails | Retrying finalization is safe and idempotent. |
| Scheduled development while an upload is pending | The roll waits in `developing` until the upload finishes. |
| Member leaves before development | Their photos stay on the roll and are revealed; they lose access. |
| Member joins after development | Sees past rolls unless the group turns off "New members see past rolls". |
| Nobody shot anything | The roll develops on its date as an empty album with a prompt to start a new one. |
| Camera unavailable or permission denied | Falls back to the phone's own camera (`capture=environment`). There is no photo-library picker: the fallback only accepts a file created in the last 5 minutes, and the server rejects any photo submitted more than 30 minutes after it was taken. |
| Account deletion | Removes your photos (exposures on live rolls are given back), comments, reactions, favorites and notifications, transfers ownership of your groups, then deletes your auth account. |

## Local development (Firebase emulators)

Requires Node 22+ and **Java 21** for the emulators (`brew install openjdk@21`).

```bash
npm install && npm --prefix functions install
cp .env.example .env              # VITE_USE_EMULATORS=true by default
npm run emulators                 # auth, firestore, storage, functions (+ UI on :4000)
npm run dev                       # http://localhost:5173
```

If Java 17 is your default: `export JAVA_HOME=/opt/homebrew/opt/openjdk@21`.

### Testing on your phone

```bash
npm run emulators     # terminal 1
npm run dev:phone     # terminal 2 → prints https://<your-LAN-IP>:5173
```

`dev:phone` serves the app over HTTPS with a self-signed certificate (phone browsers only allow the camera on secure pages). It also proxies the Auth, Firestore, Storage and Functions emulators through that one address, so the phone only needs to reach the dev server. Open the Network URL on a phone on the same Wi-Fi and accept the certificate warning:
- **iPhone (Safari):** Show Details → visit this website.
- **Android (Chrome):** Advanced → Proceed.

Scheduled functions don't run on their own in the emulator. `scripts/e2e.ts` shows how to call `runSweep()` directly.

## Tests

```bash
npm test             # unit tests: state machine, exposure math, presets, validation, memories
npm run test:rules   # Firestore + Storage rules (emulator)
npm run test:e2e     # backend end-to-end: real callables, uploads, concurrency, sweeper (emulator)
node scripts/browser-e2e.mjs http://localhost:5173 e2e-screens   # mobile UI walkthrough (needs emulators + dev server + Chrome)
```

`test:e2e` covers: invites; rejecting old photos; idempotent reservations; finalizing twice; rejecting non-image bytes; privacy before development (Firestore and the photo endpoint, including the uploader); 6 people racing for the last 3 exposures; automatic development when full; scheduled development with an upload in flight; empty rolls; cancelling; leaving and rejoining; history visibility; invite rotation; account deletion.

`browser-e2e.mjs` drives two phone-sized users through the whole app in Chrome with a fake camera: sign-up, onboarding, creating a group, joining by invite, loading a roll, camera and gallery shots, the reveal, the album, the viewer, reactions, comments, notifications and reduced motion.

## Deploying

1. Create a Firebase project and enable **Authentication** (Google and Email/Password), **Firestore**, **Storage** and **Functions** (Functions needs the Blaze plan).
2. Add your web app config to `.env` and set `VITE_USE_EMULATORS=false`. Add your domain under Auth → Settings → Authorized domains.
3. Deploy the backend:
   ```bash
   npx firebase use --add                 # pick your project
   npx firebase deploy --only firestore,storage,functions
   ```
   The first functions deploy may need a retry while Google Cloud finishes setting up permissions for a new project.
4. Host the web app:
   - **Firebase Hosting:** set `VITE_PHOTO_ENDPOINT=/api/photo` (`firebase.json` rewrites it to the function on the same origin), then `npm run build && npx firebase deploy --only hosting`.
   - **Anywhere else (e.g. Vercel):** leave `VITE_PHOTO_ENDPOINT` empty and the app calls `https://<region>-<project>.cloudfunctions.net/photo` directly; the function allows cross-origin requests and needs a bearer token.

Rate limits can be turned off for testing with `DISABLE_RATE_LIMITS=true` in `functions/.env.<project>`. Never leave that on in production.

## Not included yet

- Web push notifications (in-app notifications are implemented; FCM can be added later).
- Offline capture with queued uploads; the app tells you when a connection is required.
- Album ZIP export, prints, voice captions, yearly books (the data model leaves room for these).
- Group cover *images* (groups have colour themes instead).
- Multiple active rolls per group (rolls are a collection; the MVP enforces one in `startRoll`).

## Note on iCloud Desktop

If this folder lives on an iCloud-synced Desktop with "Optimize Mac Storage" turned on, macOS can evict files in `node_modules` and even source files, which breaks Node and Vite with "Invalid package config" or empty-file errors. Keep the project somewhere outside iCloud (for example `~/Developer`). Or store dependencies in a `node_modules.nosync` folder with a `node_modules` symlink pointing to it; `vite.config.ts` already sets `preserveSymlinks` for that setup.
