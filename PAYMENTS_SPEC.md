# Payments Spec — v1

## Two-layer reality
Participants pay sub-group leaders (informal, opaque). Leaders pay central admin in **lump sums** via MoMo. System models layer 2.

## Design — two-layer claim + confirm flow (built across 5b-i and 5b-ii)

The original CSV-allocation model (steps 2–4: generate roster → leader fills amountPaid → admin uploads) has been superseded by an in-system two-step flow. The old CSV upload feature remains in the UI as a legacy escape hatch but is no longer the primary path.

### Claim layer (5b-i)
Leaders mark who paid via an in-system roster screen. Per participant, it is binary: **Paid / Not paid** — no amounts, because the leader handles lump sums, not per-person accounting.

```ts
paymentClaimed: boolean     // leader's assertion
claimedBy: string           // leader uid
claimedAt: Timestamp
```

**Critical constraint:** `paymentClaimed` is a signal, NOT a confirmation. It does not change `amountPaid`, `paymentState`, or rooming eligibility. Leaders cannot write `amountPaid` or any rooming field — blocked by Firestore rules and enforced server-side in `setPaymentClaim`.

### Confirmation layer (5b-ii)
Admin opens the batch detail, sees the list of claimed-but-unconfirmed participants for that sub-group, and compares:

- **Expected** = Σ `feeOwed` of claimed-unconfirmed participants
- **Received** = `batch.amountReceived`

**Clean match (expected === received):**
"Reconcile & Confirm" button is enabled. One Firestore transaction:
- For each claimed-unconfirmed participant: sets `amountPaid = feeOwed`, `confirmedAt`, `confirmedBy`, `confirmedBatchId` → `derivePaymentState` returns PAID → rooming unlocks.
- Sets batch `status = 'RECONCILED'`, `amountAllocated = amountReceived`.
- All-or-nothing: any failure (participant not found, cross-sub-group mismatch, already confirmed, wrong amount) aborts the entire transaction.

**Mismatch (expected ≠ received):**
"Reconcile & Confirm" is disabled. "Reconcile with Variance" is always available as an escape hatch:
- Sets batch `status = 'RECONCILED'`, `varianceAcknowledged: true`, `varianceNote` (required).
- Does **NOT** confirm any participant — they stay claimed-but-unconfirmed and remain unroomable.
- Admin uses the per-person payment override (Day 4c) if they must room someone before the variance is resolved.

**Un-confirming confirmed participants is out of scope for v1 (Phase 2).** Confirmed participants stay confirmed even if the batch is reopened.

### Full two-step flow
1. **Leader claims**: opens roster, taps "Mark paid" per person who handed them money. Running total shows the lump sum to expect.
2. **Admin confirms**: opens batch, sees claimed participants list + Σ feeOwed vs received comparison. On clean match → "Reconcile & Confirm" → all become PAID + roomable atomically. On mismatch → "Reconcile with Variance" → batch closes without confirming anyone.

## Core entities
- **PaymentBatch** — lump sum received from a sub-group. Has reference code and OPEN/RECONCILED status.
- **Allocation** — legacy: record that money from a batch covers a specific participant's fee (CSV-upload flow). Immutable (voided allocations leave an audit row). No longer the primary confirmation path.
- **Participant.amountPaid** — set to `feeOwed` by `reconcileAndConfirm`; historically incremented by allocations. Kept in sync transactionally.

## Derived payment state
- `feeOwed === 0` → WAIVED
- `amountPaid >= feeOwed` → PAID
- `0 < amountPaid < feeOwed` → PARTIAL
- `amountPaid === 0` → PENDING

Rooming blocked unless PAID or WAIVED (with admin override path — see ROOMING_SPEC.md).

## Setup
Room types have a `price`. Set before opening registration.

## Registration impact
Public registration form:
1. Shows room types with prices
2. Requires a sub-group selection
3. **After sub-group selection, checks for unreconciled batches** in that sub-group with non-zero balance. If found, blocks registration (see "Registration Gating" below).
4. Sets `roomTypePreferenceId`, `roomTypePreferenceName`, `feeOwed`, `amountPaid: 0`.

## Registration Gating by Reconciliation

### The rule
A sub-group cannot accept new public registrations if it has any payment batch where:
- `status === 'OPEN'` AND
- `amountReceived - amountAllocated > 0` (i.e. unallocated funds remain)

### UX on the public form
- When the registrant picks a sub-group, the page fires a query for OPEN batches with unallocated balance for that sub-group
- If results found, the form shows an inline blocker BELOW the sub-group picker:
  > ⚠️ {Sub-group name} cannot accept new registrations right now. Their last payment batch has not been fully reconciled. Please contact your council leader to resolve this before registering.
- Submit button is disabled
- Selecting a different sub-group re-runs the check

### Cloud Function enforcement
`leaderRegisterParticipant` repeats this check server-side (Admin SDK, bypasses rules) and rejects with `failed-precondition` if violated. The client-side checks below are UX only.

### Leader page UX pre-check (5b-ii)
`LeaderRegisterPage` also calls `isSubGroupGated(campId, subGroupId)` at page-load — a client-side Firestore query using the new leader `allow list` rule on `paymentBatches`. If gated, the page shows a "Registration paused for your group — pending reconciliation" state INSTEAD of the form. This prevents the leader from filling the form only to hit a server rejection, while keeping the server-side gate as the authoritative integrity check.

### Admin override
The admin-side "Add Participant" form (used for late arrivals, walk-ins, special cases) bypasses this check entirely. Done via a separate Cloud Function `adminAddParticipant` that:
- Requires admin auth
- Skips both `registrationOpen` AND reconciliation-gating checks
- Otherwise creates the same participant shape
- Sets `source` to the admin's uid

This gives admins a clean escape hatch for the rare necessary case while keeping the rule hard for self-registration.

## Batch lifecycle

### 1. Admin records the batch
Page: `/admin/camps/:id/payments` → "New Batch"

Fields:
- Sub-group (select)
- Amount received
- Method (MOMO / CASH / BANK / OTHER)
- External reference (optional)
- Received at (date)
- Notes (optional)

Auto-generates reference code: first 8 alphanumeric chars of sub-group name uppercased + "-" + sequence number (per camp). E.g. "GALATIAN-007".

### 2. Leader claims participants (in-system)
Leader logs in to their roster screen, taps "Mark paid" for each person who handed them money. The running total gives the leader the expected lump-sum figure to quote when they pay the admin.

### 3. Admin reconciles on batch detail

The batch detail page shows:
- **Claimed** column: list of claimed-but-unconfirmed participants for the sub-group, with each `feeOwed` and a Σ total.
- **Received**: `batch.amountReceived`.
- **Difference**: Match / Short / Over, with delta amount.

**Clean match (Σ feeOwed === amountReceived):**
"Reconcile & Confirm" button enabled → one atomic transaction confirms all participants as PAID and marks the batch RECONCILED. Registration block on the sub-group is removed.

**Mismatch:**
"Reconcile & Confirm" is disabled. "Reconcile with Variance" always available → marks batch RECONCILED with `varianceAcknowledged: true` + required note, without confirming any participants. Resolution is manual / out-of-band for v1.

Reconciled batches can be reopened (audit-logged: `reopenedAt`, `reopenedBy`). Reopening resets `varianceAcknowledged: false` in the same write (invariant — never stale-true on an OPEN batch). Confirmed participants are NOT un-confirmed on reopen (Phase 2).

**Note on reconciliation impact:** a batch leaving OPEN (via confirm or variance reconcile) removes the sub-group's registration gate. This is the key feedback loop — the gate gives leaders an incentive to get the lump paid and the admin an incentive to reconcile promptly.

### Legacy: CSV allocation upload (still present, no longer primary)
"Download Roster" and "Upload Allocations" buttons remain on the batch detail page for backwards compatibility and edge cases. The upload flow creates `Allocation` docs and increments `amountPaid` directly (no claim step). This path can coexist with the claim+confirm path on the same batch.

## Voiding allocations
From participant detail, "Void" on any allocation row:
- Confirm with reason
- Mark `voided: true`
- Decrement participant's `amountPaid`
- Decrement batch's `amountAllocated`
- If batch was RECONCILED, flips back to OPEN (which re-blocks registration!)

## Edge cases

### Overpayment
Leader marks ₵500 for someone owing ₵400. Allowed:
- Preview warns "₵100 overpayment for John Doe"
- Participant shows "PAID + ₵100 credit"

### Room type change after payment
Standard (₵400) → Premium (₵600) when participant has paid ₵400:
- `feeOwed` becomes 600, `amountPaid` stays 400
- Derived state flips PAID → PARTIAL
- Rooming blocks until difference paid
- Detail page shows fee gap prominently

### Waiving
Admin sets `feeOwed = 0` directly on participant. Becomes WAIVED. Rooming unlocks. Audit recorded.

### Cross-sub-group CSV row
Leader's CSV includes a participant ID belonging to a different sub-group. Hard error — no override. Prevents accidental cross-allocation.

## Admin payments page

`/admin/camps/:id/payments`

Top: per-sub-group summary table.
| Sub-group | Registered | Paid | Partial | Pending | Total Received | Total Expected | Status |

The `Status` column shows:
- ✅ Reconciled (no OPEN batches with balance)
- ⚠️ Unreconciled (has OPEN batches with balance) — clicking opens that batch
- This same indicator drives the registration-gating rule

Below: batch list with filters. Each row:
- Reference code, sub-group, date, amount received/allocated, status badge, method
- Click → batch detail

Batch detail page:
- Header: code, sub-group, amount, status, dates
- Actions: Download Roster, Upload Allocations (legacy), **Reconcile & Confirm** (enabled only on clean match) / **Reconcile with Variance** (always when OPEN) / Reopen (when RECONCILED)
- Reconciliation panel: claimed-but-unconfirmed participants list, Σ feeOwed, vs received, Match/Short/Over
- Legacy allocations list with void buttons
- **Receipts**: attached MoMo/cash handover screenshots (see DATA_MODEL.md — Firebase Storage). Visible regardless of batch status, for audit/reference lookup later. Purely evidentiary — does not feed reconciliation math.

## Out of v1 scope
- Payment aggregator integration
- Sub-group leader portal
- Auto-matching by phone/name
- Refund processing
- Multi-currency
