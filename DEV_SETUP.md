# Local Development Setup

Local dev runs entirely against the Firebase Emulator Suite — no action can read or write production.

## First-time setup

**1. Install dependencies** (if you haven't already)
```bash
npm install
cd functions && npm install && cd ..
```

**2. Build functions** (the Functions emulator needs compiled JS)
```bash
cd functions && npm run build && cd ..
```

**3. Cloud Function secrets** (optional — only needed to exercise SMS sending locally)
```bash
cp functions/.secret.local.example functions/.secret.local
# fill in BMS_API_KEY
```
`functions/.secret.local` feeds `firebase-functions/params` `defineSecret()` values to the emulator. In production, secrets are set via `firebase functions:secrets:set BMS_API_KEY` (Secret Manager), never committed. Without it, `onRoomAssigned` still runs but every provider call fails — sends land in `smsLog` as `FAILED`, nothing blocks room assignment.

**4. Redirect test texts to your own phone** (optional — only if you want to see real deliveries while testing locally, without texting the fake numbers on seeded participants)
```bash
cp functions/.env.example functions/.env   # if you haven't already, for WEB_API_KEY
# add to functions/.env:
echo "SMS_DEV_OVERRIDE_PHONE=233XXXXXXXXX" >> functions/.env
```
Every room-assignment text sent while the Functions emulator is running gets redirected to this number instead — the participant's real (fake/seeded) number is still what's validated and shown as `phone` in `smsLog`; only the actual SMS destination changes. This only ever activates under `FUNCTIONS_EMULATOR=true`, which only the emulator itself sets — leaving the var in `functions/.env` is harmless even if that file were ever accidentally deployed.

## Daily workflow

**Terminal 1 — start emulators**
```bash
npm run emulators
```

Starts Firestore (8085), Auth (9099), Functions (5001), and the Emulator UI (4000).
On subsequent runs it imports state from `./emulator-data` automatically. On exit it exports state back, so your data persists across restarts.

**Terminal 2 — seed test data** (first time, or after wiping)
```bash
npm run dev:seed
```

Creates the full test dataset and three Auth users you can log in with:

| Email | Password | Role |
|---|---|---|
| `admin@test.local` | `Admin1234!` | Admin — full dashboard |
| `leader-a@test.local` | `Leader1234!` | Leader, Galilee Council (registration **gated** — open batch) |
| `leader-b@test.local` | `Leader1234!` | Leader, Judah Council (registration open) |

Safe to re-run: it wipes the emulator namespace and recreates everything.

**Terminal 2 (or 3) — run the dev server**
```bash
npm run dev
```
                                
Open [http://localhost:5173](http://localhost:5173). The console prints `⚠️ Connected to LOCAL emulators — not production.` on every dev start — this is expected and confirms you are not touching prod.

**Emulator UI** — [http://localhost:4000](http://localhost:4000)
Browse Firestore documents, Auth users, and Function logs in real time.

## Safety guarantees

- `src/lib/firebase.ts` calls `connectFirestoreEmulator`, `connectAuthEmulator`, and `connectFunctionsEmulator` unconditionally when `import.meta.env.DEV` is true. There is no fallback — if emulators aren't running, the app errors visibly (connection refused) rather than silently hitting production.
- `import.meta.env.DEV` is set by Vite to `true` only during `vite dev`. It is always `false` in `vite build` output, so production builds are unaffected.
- App Check is skipped in dev (emulators don't enforce it) and enforced in production.

## Rebuilding functions after code changes

The Functions emulator serves `functions/lib/`. After editing a Cloud Function:
```bash
cd functions && npm run build && cd ..
# Restart the emulator (Ctrl+C + npm run emulators) to pick up changes
```

## Wiping and re-seeding

To start fresh (e.g. to test a clean registration flow):
```bash
rm -rf emulator-data   # wipe persisted state
npm run dev:seed       # re-seed (emulators must be running)
```

## Running the test suite

The functions test suite runs its own isolated emulator process (port 8085, separate project namespace `demo-camp-app-test`) so it doesn't interfere with your dev emulator:
```bash
cd functions && npm test
```
