# Data Model — Firestore

## Collections

```
/admins/{uid}

/leaders/{uid}

/camps/{campId}
  /subGroups/{subGroupId}
  /roomTypes/{roomTypeId}
  /rooms/{roomId}
  /participants/{participantId}
  /paymentBatches/{batchId}
  /allocations/{allocationId}
```

## Document shapes

### `admins/{uid}`
```ts
{
  email: string;
  displayName?: string;
  createdAt: Timestamp;
}
```

### `leaders/{uid}`
```ts
{
  email: string;
  displayName?: string;
  campId: string;             // which camp this leader belongs to
  subGroupId: string;         // which sub-group they lead — exactly one for v1
  subGroupName: string;       // denormalized
  active: boolean;            // admin can deactivate without deleting
  createdAt: Timestamp;
  createdBy: string;          // admin uid who provisioned them
  updatedAt: Timestamp;
  updatedBy?: string;         // admin uid (provision/deactivate/reactivate); absent for the leader's own lastLoginAt write
  lastLoginAt?: Timestamp;    // updated on successful login
}
```
Separate role and collection from `/admins/{uid}` — never merged or migrated. One leader per sub-group is enforced at write time (the create path checks no other `active: true` leader exists for that sub-group), not via schema — deactivated leaders don't block provisioning a replacement.

Created exclusively by the `provisionLeader` Cloud Function — same "Admin SDK bypasses rules, client never writes directly" pattern as `adminAddParticipant`/`leaderRegisterParticipant`. The function:
- Verifies the caller is an admin (`/admins/{caller.uid}` exists)
- Looks up the Firebase Auth user by email, or creates one if none exists
- Re-checks the one-active-leader-per-sub-group rule server-side (the client's sub-group picker exclusion is UX only)
- Rejects if the resolved uid already has an `/admins/{uid}` doc (prevents the admin/leader collision `useUserRole()` warns about)
- Creates or re-provisions `/leaders/{uid}`, then triggers Firebase's hosted password-reset email so the leader sets their own password

Deactivate/reactivate goes through the `setLeaderActive` Cloud Function, not a direct client write. (Earlier version of this doc claimed reactivation was "a simple flip with no provisioning logic to protect server-side" — that was wrong: reactivating a leader is the same one-active-leader-per-sub-group hazard as creating one, since both result in an extra `active: true` leader for a sub-group. A real instance of this — two leaders active on the same sub-group via deactivate → provision replacement → reactivate original — was the bug that caught it.) `setLeaderActive`:
- Verifies the caller is an admin
- On `active: true`, re-runs the exact same other-active-leader query `provisionLeader` does, scoped to the target leader's `subGroupId`, and rejects if one exists
- On `active: false`, no check needed — writes directly
- Firestore rules block any other direct client `update` on `/leaders/{uid}` for admins; leaders may still self-update only their own `lastLoginAt`.

### `camps/{campId}`
```ts
{
  name: string;
  location: string;
  startDate: Timestamp;
  endDate: Timestamp;
  description?: string;
  imageUrl?: string;
  minAge?: number;
  maxAge?: number;
  maxParticipants?: number;
  currency: string;                // "GHS" default
  registrationOpen: boolean;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy?: string;
}
```

### `camps/{campId}/subGroups/{subGroupId}`
```ts
{
  name: string;
  order: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `camps/{campId}/roomTypes/{roomTypeId}`
```ts
{
  name: string;
  price: number;
  defaultCapacity: number;         // typically 1, 2, 4, 20, etc.
  allowOverbook: boolean;
  order: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```
No mixed-gender flag. Couple rooms and 24 Houses-style rooms use `defaultCapacity: 1` — only the registrant is in the system; the spouse/family is outside our view.

### `camps/{campId}/rooms/{roomId}`
```ts
{
  number: string;
  roomTypeId: string;
  roomTypeName: string;
  gender: 'M' | 'F';
  capacity: number;
  currentOccupancy: number;
  notes?: string;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy?: string;
}
```

### `camps/{campId}/participants/{participantId}`
```ts
{
  // Identity (form fields)
  fullName: string;
  phone: string;
  email?: string;
  gender: 'M' | 'F';
  dateOfBirth?: Timestamp;
  age?: number;
  // NOTE: emergency contact fields REMOVED.

  // Sub-group
  subGroupId: string;
  subGroupName: string;

  // Room type preference
  roomTypePreferenceId: string;
  roomTypePreferenceName: string;
  feeOwed: number;

  // Tags (multi, admin-managed post-registration)
  tags: string[];                  // default []

  // States
  registrationState: 'REGISTERED' | 'CANCELLED';
  checkInState: 'NOT_ARRIVED' | 'ARRIVED';
  // paymentState DERIVED — not stored.

  // Room assignment
  roomId?: string;
  roomNumber?: string;
  roomAssignedBy?: string;
  roomAssignedAt?: Timestamp;

  // Cached payment total
  amountPaid: number;              // default 0

  // Audit-only override flag
  // Set when admin assigns a room to a non-PAID/WAIVED participant.
  // Visible in UI as a red banner and counted on dashboard.
  roomedWithoutFullPayment: boolean;
  roomedWithoutFullPaymentNote?: string;

  // Check-in audit
  checkedInBy?: string;
  checkedInAt?: Timestamp;

  // Source: admin uid for admin-side add, leader uid for the leader-scoped
  // flow. 'self' is historical only — written by the now-removed public
  // self-select form; existing participants from before the leader-auth
  // pivot may still have it, but no current code path produces it.
  source: 'self' | string;         // 'self' (historical), admin uid, or leader uid

  // General
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  updatedBy?: string;
}
```

**Deriving `paymentState`:**
- `feeOwed === 0` → `WAIVED`
- `amountPaid >= feeOwed` → `PAID`
- `0 < amountPaid < feeOwed` → `PARTIAL`
- else → `PENDING`

### `camps/{campId}/paymentBatches/{batchId}`
```ts
{
  referenceCode: string;           // e.g. "GALATIAN-007"
  subGroupId: string;
  subGroupName: string;
  amountReceived: number;
  amountAllocated: number;
  method: 'MOMO' | 'CASH' | 'BANK' | 'OTHER';
  externalReference?: string;
  receivedAt: Timestamp;
  receivedBy: string;
  notes?: string;
  status: 'OPEN' | 'RECONCILED';
  varianceAcknowledged: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `camps/{campId}/allocations/{allocationId}`
```ts
{
  batchId: string;
  participantId: string;
  participantName: string;
  amount: number;
  createdAt: Timestamp;
  createdBy: string;
  voided: boolean;
  voidedBy?: string;
  voidedAt?: Timestamp;
  voidReason?: string;
}
```

## Key derivations

### Registration gating by reconciliation
Query, scoped to a sub-group:
```
batches where subGroupId === target AND status === 'OPEN' AND (amountReceived - amountAllocated) > 0
```
If any results, block submission with the council-leader message. Otherwise, allow.

The gate lives entirely in **`leaderRegisterParticipant`** now. There is no sub-group picker — `subGroupId` comes from the caller's own `/leaders/{uid}` doc, so the gate can only ever apply to the leader's own sub-group. Scoped automatically by the auth boundary, not a client-supplied value.

Bypassed by **admin-side "Add Participant"** (`adminAddParticipant`) by design — the admin escape hatch skips this check entirely.

The public self-select flow (`/r/:campId`, `registerParticipant`) — which had its own, client-trusting copy of this gate — was retired and fully removed from the codebase in the post-Day-C cleanup. Leader-auth registration is the sole registration path. `paymentBatches` itself still has no UI yet (Payments is still a placeholder), so this gate is wired up and correct but inert — it can't block anything until batch documents actually exist.

### Override flag on room assignment
When admin clicks Assign Room and the participant's derived `paymentState` is `PENDING` or `PARTIAL`:
- Show confirmation modal: "This participant has not paid in full. Assigning anyway requires a reason."
- Required text input for reason
- On confirm, set `roomedWithoutFullPayment: true` and store the reason
- All other transaction steps proceed normally

If a later payment moves them to PAID, the flag stays `true` (for audit). To clear it, admin must manually unset (or it persists as an "was once short" indicator — design choice).

## Transactions (unchanged from prior spec)
- Creating allocations from CSV upload — see PAYMENTS_SPEC.md
- Voiding allocations
- Assigning rooms
- Changing room type (recomputes feeOwed)

## Security rules

### `paymentBatches` — admin-only, no public read
```
match /camps/{campId}/paymentBatches/{batchId} {
  allow read, write: if isAdmin();
}
```
An earlier version of this doc specced a public `allow get: if true` rule here, justified by the public form needing to check for unreconciled batches client-side. That rule was never actually implemented in `firestore.rules`, and there was no `paymentBatches` rule at all until the post-Day-C cleanup added the admin-only one above — Payments still has no UI (placeholder route), so until now there was no rule and no documents either. Now that the public form is removed and the reconciliation gate lives entirely server-side in `leaderRegisterParticipant` (Admin SDK, bypasses rules), there's no reason for any non-admin read access. Verified by `functions/src/paymentBatches.rules.test.ts` (admin read succeeds, unauthenticated and non-admin reads are denied) — this is the one rules-behavior test in the suite; everything else tests Cloud Function logic via the Admin SDK, which always bypasses rules and can't verify them.

### Leader-scoped participant reads (leader-auth pivot)
```
match /camps/{campId}/participants/{participantId} {
  allow get, list: if isActiveLeader()
      && leaderDoc().data.campId == campId
      && resource.data.subGroupId == leaderDoc().data.subGroupId;
}
```
A leader can read participants only within their own camp and own sub-group. For `list`, Firestore requires the query itself to filter on `subGroupId` for the rule to provably hold — an unscoped query is rejected outright. No leader-facing list UI consumes this yet (Day C only ships the registration form); this is foundation for a future leader view, same pattern as shipping role detection (Day A) ahead of the admin leader-management UI (Day B). `create` stays `if false` for everyone, including leaders — all participant writes go through Cloud Functions.

All other rules unchanged from prior spec.

## CSV formats unchanged
Roster: `participantId, fullName, phone, roomTypePreference, feeOwed, amountPaid`
Returned: same shape; only `participantId` and `amountPaid` are read.
