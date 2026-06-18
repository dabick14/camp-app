# Hubtel Integration Spec

How the Camp App takes MoMo (and card/wallet) payments through **Hubtel Online Checkout**,
converting each confirmed payment into a `PaymentBatch`.

This integration is scoped to payment **ingestion** only. Allocation (batch → participant),
roster CSVs, and reconciliation remain the existing manual, human-in-the-loop flow.

## TL;DR of the model

- An admin records a payment **in the app** (onsite checkout), like any normal checkout.
  Council leaders are not sent links.
- Nothing arrives unsolicited — every payment is tied to a checkout **we initiated** with a
  `clientReference` we control, so matching is deterministic.
- There is **no reliable webhook signature**. Integrity comes from two things:
  1. a callback only matters if its `clientReference` matches a checkout session we created, and
  2. the **Transaction Status Check** API is the authoritative source of truth.
- Amounts are **GHS (2dp)**, not pesewas. Hubtel deducts its own fees on their side.

## Components

| Piece | Location |
|---|---|
| Outbound API client (initiate + status check) | `functions/src/hubtel/hubtelClient.ts` |
| Callback parsing | `functions/src/hubtel/parseCallback.ts` |
| Idempotent apply core | `functions/src/hubtel/applyHubtelPayment.ts` |
| `initiateHubtelCheckout` (admin HTTP) | `functions/src/hubtel/initiateHubtelCheckout.ts` |
| `verifyHubtelPayment` (admin HTTP) | `functions/src/hubtel/verifyHubtelPayment.ts` |
| `hubtelPaymentCallback` (public HTTP) | `functions/src/hubtel/hubtelPaymentCallback.ts` |
| Admin UI (viewer, checkout modal, quarantine) | `src/features/payments/hubtel/` |

## The flow (dual confirmation, one source of truth)

```
Admin → "New payment" (sub-group + amount)
      → initiateHubtelCheckout
          • generate clientReference (≤32 chars)
          • write session: camps/{campId}/hubtelTransactions/{reference}  (PENDING)
          • write pointer:  hubtelReferences/{reference} = { campId }
          • POST Hubtel /items/initiate → checkoutUrl + checkoutDirectUrl
      → admin pays in the embedded Hubtel checkout (iframe)

Confirmation arrives by EITHER path — both call applyHubtelPayment(reference):
  (a) Webhook  : Hubtel POSTs callback → hubtelPaymentCallback
  (b) Verify   : the modal/return page polls verifyHubtelPayment → status check

applyHubtelPayment (one Firestore transaction, idempotent):
  • load session by reference; if already MATCHED → no-op (returns existing batchId)
  • guard: currency must be GHS; paid ≥ amountExpected (no underpayment)
  • create camps/{campId}/paymentBatches/{auto} (source:'hubtel', status:'OPEN')
  • flip session → MATCHED (+ batchId, channel, sender, receivedAt)
```

Because both paths funnel through the same idempotent function keyed on the session doc,
retries and races cannot create duplicate batches.

## Webhook contract

**Endpoint:** `POST https://us-central1-camp-app-119bb.cloudfunctions.net/hubtelPaymentCallback`

**Body we expect** (PascalCase per Hubtel docs; camelCase tolerated):

```json
{
  "ResponseCode": "0000",
  "Status": "Success",
  "Data": {
    "CheckoutId": "59e2...",
    "ClientReference": "CAMP_ABC_123",
    "Status": "Success",
    "Amount": 0.5,
    "CustomerPhoneNumber": "233242825109",
    "PaymentDetails": { "PaymentType": "mobilemoney", "Channel": "mtn-gh" }
  }
}
```

**Responses we return:**

| Situation | HTTP | Effect |
|---|---|---|
| Valid Success, reference matches a session | `200` | Batch created / already-applied (idempotent) |
| Success, reference matches **no** session | `200` | Written to `hubtelQuarantine/{id}` for admin review |
| Non-success status | `200` | Acknowledged; session marked FAILED if found |
| Unparseable body | `200` | Acknowledged (nothing actionable) |
| Invalid signature (only when secret + header present) | `401` | Rejected, no writes |
| Unexpected/transient error | `500` | Hubtel may retry; idempotency makes that safe |

`200` once acknowledged means Hubtel stops retrying — quarantine counts as acknowledged.

## Status check (authoritative)

`GET https://rmsc.hubtel.com/v1/merchantaccount/merchants/{merchant}/transactions/status?clientReference={ref}`
— public endpoint, **no IP whitelisting**. `status` of `Paid` ⇒ confirm. Used by
`verifyHubtelPayment`, which the checkout modal and the `/pay/return` page poll.

## Quarantine + manual recovery

A **Success** callback whose `clientReference` matches no session lands in
`hubtelQuarantine/{id}` (we never drop money). In **Hubtel transactions**, quarantined
items show in an amber panel. An admin clicks **Resolve** →
- **Assign to a sub-group:** creates a `PaymentBatch` (source `hubtel`) for that sub-group
  and marks the quarantine doc `MATCHED`. Not unlinkable afterwards (audit-only).
- **Mark refunded:** sets the quarantine doc `REFUNDED` (handle the actual refund in Hubtel).

## Data written

### `camps/{campId}/hubtelTransactions/{reference}` (session + audit)
`reference, checkoutId, checkoutUrl, amount, amountExpected, senderPhone, description,
subGroupId, subGroupName, status (PENDING|MATCHED|FAILED|QUARANTINED|REFUNDED), batchId,
channel, channelProvider, receivedAt, rawPayload, createdBy, createdAt, updatedAt,
matchedAt, matchedBy ('auto' = webhook, admin uid = verify/manual)`.

### `hubtelReferences/{reference}` (pointer)
`{ campId, createdAt }` — lets the public callback resolve `campId` from the reference
without a collection-group query.

### `hubtelQuarantine/{id}` (orphans)
`reference, checkoutId, amount, senderPhone, channel, status, rawPayload, receivedAt,
createdAt` (+ `batchId, campId, matchedBy, matchedAt` once resolved).

### `PaymentBatch` — additive fields introduced here
The existing `paymentBatches` doc gains (all optional/additive, so the base payments
feature is unaffected):
`source: 'manual' | 'hubtel'`, `hubtelReference?`, `hubtelCheckoutId?`, `channel?`,
`channelProvider?`. Hubtel-created batches are written with `status: 'OPEN'`,
`method: 'MOMO'`, `source: 'hubtel'`. Existing manual batches should be read as
`source: 'manual'` by default (none exist yet, so no backfill is needed today).

## Security

- `initiateHubtelCheckout` / `verifyHubtelPayment` require a Firebase admin ID token
  (Bearer) and presence in `/admins`.
- `hubtelPaymentCallback` is public (Hubtel must reach it) and writes via the admin SDK.
  Optional HMAC check on `x-hubtel-signature` / `x-webhook-signature` when a secret is set.
- Firestore rules: `paymentBatches`, `hubtelTransactions`, `hubtelReferences`,
  `hubtelQuarantine` are all admin-only for client access.
- Full webhook payloads are stored only in Firestore (`rawPayload`); never echoed in
  error responses (PII).

## Failure modes & recovery

| Symptom | Cause | Recovery |
|---|---|---|
| Payment made, no batch within ~1 min | Callback delayed/lost | The modal/return page status-check confirms it; or hit **Refresh** — the next status check applies it. |
| Money in, payment "quarantined" | Callback reference matched no session (e.g. a checkout from elsewhere) | **Resolve** → assign to sub-group, or mark refunded. |
| `verifyHubtelPayment` returns PENDING repeatedly | Hubtel still processing | The webhook is the prod source of truth; it will apply when Hubtel finalizes. |
| Wrong amount / currency | Underpayment or non-GHS | `applyHubtelPayment` refuses to confirm (reason `UNDERPAID`/`WRONG_CURRENCY`); session stays PENDING for review. |
| `initiate` fails | Bad/missing secrets, Hubtel error | Session marked `FAILED`; check `HUBTEL_*` secrets (see HUBTEL_SETUP.md). |

## Day-to-day for an admin

1. Open a camp → **Hubtel** tab.
2. **New payment** → pick the sub-group and amount → **Continue to payment**.
3. Complete the MoMo prompt in the embedded checkout. The window confirms automatically.
4. The confirmed payment appears as a **Matched** row and a `PaymentBatch` now exists for
   that sub-group — allocate it to participants via the normal payments flow.
5. Watch the amber **Quarantined** panel for stray payments and resolve them.

## Testing

- Unit (no emulator): `npm --prefix functions test` — phone normalization, callback
  parsing, status mapping, reference generation, and the API client (mocked `fetch`).
- Integration (emulator): `firebase emulators:exec --only firestore "npm --prefix functions test"`
  — exercises `applyHubtelPayment` (batch creation, idempotency, underpayment, no-session).

## Out of scope

Allocation logic, roster CSV, the base `/payments` page, registration gating, refund
*processing* (we only flag), multi-currency, and auto-allocation.
