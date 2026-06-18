# Hubtel Setup

Secrets and configuration for the Hubtel Online Checkout integration. **Do not commit
secret values.** They are stored as Firebase Functions (v2) secrets, not in `.env` or
`functions.config()`.

## Required secrets

| Secret | What it is | Where to find it |
|---|---|---|
| `HUBTEL_API_KEY` | API key (the password half of Basic Auth) | Hubtel dashboard → API keys |
| `HUBTEL_ACCOUNT_ID` | Account / client ID (the username half of Basic Auth) | Hubtel dashboard → API keys |
| `HUBTEL_MERCHANT_ACCOUNT_NUMBER` | POS / Collection Account Number used in `merchantAccountNumber` and the status-check URL | Hubtel dashboard → Merchant account |
| `HUBTEL_WEBHOOK_SECRET` | *Optional.* If set, and Hubtel sends a signature header, callbacks are HMAC-verified | You choose it; configure on Hubtel's side if/when they support signed callbacks |

Auth header sent to Hubtel is `Basic base64("<HUBTEL_ACCOUNT_ID>:<HUBTEL_API_KEY>")`.

## Setting the secrets (v2)

```bash
firebase functions:secrets:set HUBTEL_API_KEY
firebase functions:secrets:set HUBTEL_ACCOUNT_ID
firebase functions:secrets:set HUBTEL_MERCHANT_ACCOUNT_NUMBER
# optional:
firebase functions:secrets:set HUBTEL_WEBHOOK_SECRET
```

Each command prompts for the value and stores it in Google Secret Manager. The functions
that need them declare them via `defineSecret`, so they are injected at runtime only.

- `initiateHubtelCheckout` and `verifyHubtelPayment` use `HUBTEL_API_KEY`,
  `HUBTEL_ACCOUNT_ID`, `HUBTEL_MERCHANT_ACCOUNT_NUMBER`.
- `hubtelPaymentCallback` uses `HUBTEL_WEBHOOK_SECRET` (optional).

Re-deploy after changing a secret: `npm --prefix functions run deploy`.

## Hubtel dashboard configuration

1. **Callback URL** — set the merchant account's callback to:
   `https://us-central1-camp-app-119bb.cloudfunctions.net/hubtelPaymentCallback`
   (We also pass this as `callbackUrl` on every checkout, so this is belt-and-braces.)
2. **Return URL** — handled automatically; the app passes its own origin +
   `/pay/return?reference=…&campId=…` at init time.
3. No IP whitelisting needed — status checks use the public `rmsc.hubtel.com` endpoint.

## Local development

- The frontend calls the deployed functions by default
  (`https://us-central1-camp-app-119bb.cloudfunctions.net/...`). To use the emulator,
  run the functions emulator and adjust the base URL while testing.
- For emulator-backed function tests:
  `firebase emulators:exec --only firestore "npm --prefix functions test"`.

## Constants (non-secret)

Deployment URLs live in `functions/src/hubtel/constants.ts` (`FUNCTIONS_BASE`,
`APP_BASE`, `HUBTEL_CALLBACK_URL`). Update them if the project ID or hosting domain changes.
