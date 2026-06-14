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

Go to **Settings → Secrets and variables → Actions → New repository secret** and add all of the following.

### Firebase service account (used by both jobs)

| Secret | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Raw JSON content of a Firebase service account key with `Firebase Hosting Admin` + `Cloud Functions Developer` roles. **Paste the entire JSON, not base64.** |
| `FIREBASE_PROJECT_ID` | Your Firebase project ID (e.g. `camp-app-abc12`) |

To generate the key:
1. Firebase Console → Project Settings → Service accounts
2. **Generate new private key** → download the JSON
3. Open the file, copy the entire contents, paste as the secret value

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
