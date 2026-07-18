# CI/CD — Firebase Hosting + Cloud Functions

`deploy.yml` runs on every push to `main` and deploys only what changed:

| Changed paths | Jobs that run |
|---|---|
| Anything outside `functions/` | `deploy-hosting` |
| `functions/**` | `deploy-functions` |
| Both | Both jobs (in parallel) |
| Manual trigger | Both jobs always |

---

## Required GitHub Secrets

Secrets are stored in the **`production` environment** (Settings → Environments → production → Environment secrets). Both deploy jobs declare `environment: production` so they can access them.

### Firebase service account (used by both jobs)

| Secret | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Raw JSON content of a Firebase service account key. **Paste the entire JSON, not base64.** |
| `FIREBASE_PROJECT_ID` | Your Firebase project ID (e.g. `camp-app-abc12`) |

To generate the key:
1. Firebase Console → Project Settings → Service accounts
2. **Generate new private key** → download the JSON
3. Open the file, copy the entire contents, paste as the secret value

**That key belongs to the default Firebase Admin SDK service account
(`firebase-adminsdk-...@<project>.iam.gserviceaccount.com`), which has no
deploy permissions by default** — it's meant for the Admin SDK talking to
Firestore/Auth at runtime, not for `firebase deploy`. Firebase's own IAM docs
say the standard Firebase predefined roles (including `Firebase Admin`) are
*not* sufficient for deploying functions — grant these explicitly in
Cloud Console → IAM, or via gcloud:

```bash
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:<SA_EMAIL>" --role="roles/cloudfunctions.admin"
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:<SA_EMAIL>" --role="roles/iam.serviceAccountUser"
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:<SA_EMAIL>" --role="roles/serviceusage.serviceUsageConsumer"
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:<SA_EMAIL>" --role="roles/firebasehosting.admin"
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:<SA_EMAIL>" --role="roles/secretmanager.admin"
```

- `serviceusage.serviceUsageConsumer` — without it, deploy fails checking
  whether required APIs (`cloudfunctions`, `cloudbuild`, `artifactregistry`)
  are enabled, even though they already are.
- `cloudfunctions.admin` + `iam.serviceAccountUser` — without these, deploy
  fails with `Permission 'cloudfunctions.functions.list' denied` (or
  `.create`/`.update`), because `Cloud Functions Developer` alone isn't
  enough for a CI identity to manage functions end-to-end.
- `secretmanager.admin` — needed by the `firebase functions:secrets:set`
  step (see below). It has to create the secret on first run, add new
  versions on every run, and grant the function's runtime service account
  `secretAccessor` on it (`--force` does the auto-grant, but the CI identity
  still needs permission to make that grant). Narrower roles exist
  (`secretVersionManager` + `securityAdmin`) but haven't been tried here —
  start with `admin` and narrow later if desired, same as the other roles
  on this list were discovered by hitting the missing-permission error
  rather than guessing up front.
- **One-time, separate from IAM roles:** the Secret Manager API itself must
  be enabled on the GCP project before `secretmanager.admin` does anything
  useful — a role grants permissions *within* an API, it doesn't turn the
  API on. This surfaces as `Permissions denied enabling
  secretmanager.googleapis.com` even with the role correctly granted. Fix,
  run once by a project owner (not the CI service account):
  ```bash
  gcloud services enable secretmanager.googleapis.com --project=<PROJECT_ID>
  ```
- These functions are Gen 2 (Cloud Run-backed under the hood). If a future
  deploy fails on an Artifact Registry permission instead, that's the next
  layer down — grant `roles/artifactregistry.writer` on the `gcf-artifacts`
  repo when/if that actually happens, rather than pre-granting it now.

### Vite build-time env vars (used by `deploy-hosting` only)

These are baked into the frontend bundle at build time. Use production values, not local dev values.

| Secret | Where to find it |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase Console → Project Settings → General → Your apps |
| `VITE_FIREBASE_AUTH_DOMAIN` | Same as above |
| `VITE_FIREBASE_PROJECT_ID` | Same as above |
| `VITE_FIREBASE_STORAGE_BUCKET` | Same as above |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Same as above |
| `VITE_FIREBASE_APP_ID` | Same as above |
| `VITE_RECAPTCHA_SITE_KEY` | Google Cloud Console → reCAPTCHA Enterprise → your site key |

> **`VITE_APPCHECK_DEBUG_TOKEN` is intentionally absent from CI.** That token bypasses App Check enforcement and is for local dev only. The production build uses the real reCAPTCHA provider.

### Cloud Functions runtime env vars (used by `deploy-functions` only)

Written to `functions/.env` on the runner right before deploy (that file is gitignored locally — CI has no other way to get it). Firebase CLI picks up `functions/.env` automatically at deploy time and sets it as the function's runtime environment.

| Secret | Value |
|---|---|
| `WEB_API_KEY` | Same value as `VITE_FIREBASE_API_KEY` above — Firebase Console → Project Settings → General → Web API Key. Used by `provisionLeader` to trigger Identity Toolkit's password-reset email. |

### Cloud Functions secrets (Secret Manager — used by `deploy-functions` only)

Unlike the plain env vars above, these are pushed into **Secret Manager** via `firebase functions:secrets:set --data-file -` right before deploy (see the `Set BMS_API_KEY secret` step) — the value never lands in a file on the runner, and only functions that declare it in their `secrets: [...]` array (via `firebase-functions/params`'s `defineSecret`) can read it at runtime. This is the preferred path for any *real* third-party API key (one with actual spend/access) — plain `functions/.env` stays reserved for lower-sensitivity values like `WEB_API_KEY` above. Future integrations (e.g. Resend) should follow this same pattern: one `defineSecret()` in code, one GitHub secret, one `firebase functions:secrets:set` step.

| Secret | Value |
|---|---|
| `BMS_API_KEY` | BMS Africa (mnotify) SMS API key — https://developer.bms.africa. Used by `onRoomAssigned` to send room-assignment texts. |

---

## Triggering a manual deploy

1. GitHub → **Actions** tab
2. Select **Deploy to Firebase** in the left sidebar
3. **Run workflow** → choose `main` → **Run workflow**

This always runs both jobs regardless of what changed.

---

## Rolling back

### Hosting
Firebase Console → **Hosting** → **Release history** → find the previous release → **⋮ → Roll back to this release**. Takes effect immediately, no redeploy needed.

### Functions
Roll back by reverting the commit on `main` and pushing. The next CI run redeploys the previous function code. Alternatively, use the Firebase Console → **Functions** to inspect deployed versions, or deploy a specific git ref manually:

```bash
git checkout <previous-sha>
cd functions && npm ci && npm run build && cd ..
firebase deploy --only functions --project <project-id>
```

---

## Deploy duration (approximate)

| Job | Cold (no cache) | Warm (cached deps) |
|---|---|---|
| `deploy-hosting` | ~2 min | ~45 s |
| `deploy-functions` | ~3–4 min | ~2 min |

Both jobs run in parallel when both are triggered.
