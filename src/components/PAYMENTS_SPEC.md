# Payments Spec — v1

## The two-layer reality
Participants pay sub-group leaders (informally, opaque to central). Leaders pay central admin in **lump sums** via MoMo. The system models layer 2 only.

## Core entities
- **Payment Batch** — a lump sum received from a sub-group. Has an amount, a reference code, and a "OPEN/RECONCILED" status.
- **Allocation** — a record that some money from a batch covers a specific participant's fee. Immutable (voids leave an audit trail).
- **Participant.amountPaid** — sum of valid (non-voided) allocations to this participant. Cached on the doc, kept in sync transactionally.

## Derived payment state
`paymentState` is **not stored**. Computed wherever displayed:
- `feeOwed === 0` → `WAIVED`
- `amountPaid >= feeOwed` → `PAID`
- `0 < amountPaid < feeOwed` → `PARTIAL`
- `amountPaid === 0` → `PENDING`

Rooming is blocked unless `PAID` or `WAIVED`. `PARTIAL` does not unlock rooming.

## Setup
On the camp settings page, room types now include a **price** field (per DATA_MODEL.md). Set prices before opening registration.

## Registration impact
Public registration form must:
1. Show available room types with prices (e.g. "Dormitory — ₵250, Standard — ₵400, Premium — ₵600")
2. Require a selection
3. Set the participant's `roomTypePreferenceId`, `roomTypePreferenceName`, and `feeOwed` (= type's current price)
4. Set `amountPaid = 0` initially

## Batch lifecycle

### 1. Admin records the batch
Page: `/admin/camps/:id/payments` → "New Batch" button.

Form fields:
- Sub-group (select)
- Amount received (number)
- Method (MOMO / CASH / BANK / OTHER)
- External reference (optional — MoMo TXID, bank ref)
- Received at (date)
- Notes (optional)

On save:
- Generate a **reference code** like `CHOIR-042` (first 5 alphanumeric chars of sub-group, uppercase + sequence number for the camp)
- Save batch with `status: 'OPEN'`, `amountAllocated: 0`, `varianceAcknowledged: false`
- Redirect to batch detail page

### 2. Admin generates the roster CSV
On the batch detail page, "Download Roster" button. Generates a CSV scoped to that sub-group:

```
participantId,fullName,phone,roomTypePreference,feeOwed,amountPaid
{uuid},John Doe,0244111222,Standard,400,
```

Only includes participants where `registrationState === 'REGISTERED'`. The `amountPaid` column is blank — leader fills it in.

Admin sends CSV to leader via WhatsApp / email / whatever channel they prefer. **Outside the system.** No leader access required.

### 3. Leader fills + returns
Leader puts the actual amount paid by each person under the participant in the `amountPaid` column. Leaves blank for people they're not covering in this batch. Sends back.

### 4. Admin uploads allocations
On the batch detail page, "Upload Allocations" button. Admin selects the returned CSV.

System parses:
- Reads only `participantId` and `amountPaid` columns
- Skips rows with empty `amountPaid`
- For each non-empty row, validates:
  - `participantId` exists in this camp
  - That participant belongs to this batch's sub-group (security check)
  - `amountPaid` is a positive number
- Shows a preview:
  - ✅ Valid rows (count + total amount)
  - ⚠️ Warnings (e.g. overpayment beyond `feeOwed` — flag but allow)
  - ❌ Errors (unknown ID, wrong sub-group, bad amount — listed with row numbers)

Sum check: if total valid allocations + already-allocated > `amountReceived`, **abort** — overspend. Admin must reconcile.

If total valid allocations + already-allocated < `amountReceived`, warn ("₵X will remain unallocated") but allow.

On confirm:
- One Firestore transaction creates all allocations
- Increments each participant's `amountPaid`
- Increments batch's `amountAllocated`
- Batch stays `OPEN` (admin can upload more allocations later, e.g. corrections)

### 5. Admin closes (reconciles) the batch
When the batch is done:
- If `amountAllocated === amountReceived`: "Mark Reconciled" — flips status, no variance
- If they differ: "Reconcile with Variance" — admin must enter a note explaining (refund pending, leader miscounted, etc.). Sets `varianceAcknowledged: true` + `status: 'RECONCILED'`

Reconciled batches can be reopened by an admin if needed (audit logged).

## Voiding an allocation
On a participant's detail view, allocations history is shown. Each row has a "Void" button:
- Confirms with reason input
- Marks allocation `voided: true`
- Decrements participant's `amountPaid`
- Decrements batch's `amountAllocated`
- If batch was RECONCILED, flips back to OPEN

## Edge cases the UI must surface

### Overpayment
A leader marks ₵500 for a participant whose `feeOwed` is ₵400. Allowed (camp might owe a refund), but:
- Preview shows warning "₵100 overpayment for John Doe"
- Participant shows "PAID + ₵100 credit"

### Room type change after payment
Admin moves participant from Standard (₵400) to Premium (₵600) after they've paid ₵400:
- `feeOwed` updates to ₵600, `amountPaid` stays at ₵400
- Derived `paymentState` flips from PAID → PARTIAL
- Room assignment becomes blocked until they pay the difference
- Participant detail page shows the gap prominently

### Waiving a fee
Admin can manually set `feeOwed = 0` on a participant. Derived state becomes WAIVED. Rooming unlocks. Audit trail records who and when in `updatedBy`/`updatedAt` + an optional note.

### Wrong sub-group in CSV
Leader's CSV has a row with `participantId` that belongs to a different sub-group. Preview rejects with error "Participant {name} is not in this sub-group's batch." Hard error — no override. Prevents accidental cross-group allocation.

## Admin payments page layout

Route: `/admin/camps/:id/payments`

Top section: per-sub-group payment summary table:
| Sub-group | Registered | Paid | Partial | Pending | Total received | Total expected |

Below: list of batches with filters (sub-group, status, date range). Each row:
- Reference code
- Sub-group
- Date received
- Amount received / allocated (e.g. ₵5000 / ₵4800)
- Status badge (OPEN / RECONCILED)
- Method
- Click → batch detail

Batch detail page:
- Header: code, sub-group, amount, status, dates
- Actions: Download Roster, Upload Allocations, Mark Reconciled / Reopen
- Allocations list (paginated): participant name, amount, when, who, void button
- If status is OPEN: prominent display of `amountReceived - amountAllocated` remaining

## What's deliberately NOT in v1
- Payment aggregator integration (Paystack/MoMo direct API)
- Sub-group leader portal / login
- Auto-matching by phone or name (we have IDs)
- Refund processing (manually handled offline)
- Multiple currencies per camp
- Partial-payment reminders / nudges
