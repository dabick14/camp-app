# Payments Spec — v1

## Two-layer reality
Participants pay sub-group leaders (informal, opaque). Leaders pay central admin in **lump sums** via MoMo. System models layer 2.

## ⚠️ Design revision (5b-i) — claim layer replaces CSV-allocation as the primary signal

The CSV-allocation model below (steps 2–4: generate roster → leader fills amountPaid → admin uploads) describes how `amountPaid` gets confirmed. That flow **still applies** for admin reconciliation (5b-ii, not yet built), but **leaders no longer fill in per-person amounts on a CSV**. Instead:

### Claim layer (built in 5b-i)
Leaders mark who paid via an in-system roster screen. Per participant, it is binary: **Paid / Not paid** — no amounts, because the leader handles lump sums, not per-person accounting. The system captures this as:

```ts
paymentClaimed: boolean     // leader's assertion
claimedBy: string           // leader uid
claimedAt: Timestamp
```

**Critical constraint:** `paymentClaimed` is a signal, NOT a confirmation. It does not change `amountPaid`, `paymentState`, or rooming eligibility. The leader's roster gives admin a pre-sorted list to reconcile against the lump-sum batch. Admin confirmation (5b-ii) is the step that reads these claims and updates `amountPaid`.

**Write path:** `setPaymentClaim` Cloud Function (callable). Leader auth, sub-group scoped server-side. Leaders cannot write `amountPaid` or any rooming field — blocked by Firestore rules.

### Revised two-step flow
1. **Leader claims** (5b-i — this phase): leader opens roster, taps "Mark paid" per person who handed them money. Running total shows what lump sum to expect.
2. **Admin confirms** (5b-ii — future): admin opens batch, sees claimed participants, confirms or adjusts amounts → updates `amountPaid` → unlocks rooming.

The batch and allocation data model below is unchanged — it's still the confirmation layer. Steps 2–4 in "Batch lifecycle" will be replaced by the confirmation UI in 5b-ii.

## Core entities
- **PaymentBatch** — lump sum received from a sub-group. Has reference code and OPEN/RECONCILED status.
- **Allocation** — record that money from a batch covers a specific participant's fee. Immutable (voided allocations leave an audit row).
- **Participant.amountPaid** — sum of valid allocations. Cached on participant doc, kept in sync transactionally.

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
The `registerParticipant` Cloud Function MUST repeat this check server-side and reject the write if violated. The client-side check is UX, not security.

### Admin override
The admin-side "Add Participant" form (used for late arrivals, walk-ins, special cases) bypasses this check entirely. Done via a separate Cloud Function `adminAddParticipant` that:
- Requires admin auth
- Skips both `registrationOpen` AND reconciliation-gating checks
- Otherwise creates the same participant shape
- Sets `source` to the admin's uid

This gives admins a clean escape hatch for the rare necessary case while keeping the rule hard for self-registration.

## Batch lifecycle (unchanged)

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

### 2. Admin generates roster CSV
On batch detail, "Download Roster" → CSV scoped to that sub-group:
```
participantId,fullName,phone,roomTypePreference,feeOwed,amountPaid
{uuid},John Doe,0244111222,Standard,400,
```
Only includes participants where `registrationState === 'REGISTERED'`. `amountPaid` column blank.

Admin sends to leader outside the system.

### 3. Leader fills + returns
Leader fills `amountPaid` per row, leaves blank for not-covered people, returns CSV.

### 4. Admin uploads allocations
"Upload Allocations" on batch detail. System parses:
- Reads `participantId` and `amountPaid` columns only
- Skips blank `amountPaid` rows
- Validates each row:
  - `participantId` exists in this camp
  - Participant belongs to this batch's sub-group (hard reject if not)
  - `amountPaid` is positive number
- Preview screen: valid / warnings / errors
- Sum check: if (this upload + already allocated) > amountReceived → ABORT with overspend error

On confirm:
- ONE Firestore transaction creates all allocation docs
- Increments each participant's `amountPaid`
- Increments batch's `amountAllocated`
- Batch stays OPEN

### 5. Admin reconciles
When done with the batch:
- If allocated == received: "Mark Reconciled"
- If different: "Reconcile with Variance" + note. Sets `varianceAcknowledged: true`.

Reconciled batches can be reopened (audit-logged).

**Note on reconciliation impact:** marking a batch RECONCILED removes the registration block on its sub-group. This is the key feedback loop — leaders are incentivized to resolve their batches because their sub-group's registration is stuck until they do.

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
- Actions: Download Roster, Upload Allocations, Mark Reconciled / Reopen
- Allocations list with void buttons
- Prominent display of `amountReceived - amountAllocated` remaining if OPEN

## Out of v1 scope
- Payment aggregator integration
- Sub-group leader portal
- Auto-matching by phone/name
- Refund processing
- Multi-currency
