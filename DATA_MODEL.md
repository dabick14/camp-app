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
  lastLoginAt?: Timestamp;    // updated on successful login
}
```
Separate role and collection from `/admins/{uid}` — never merged or migrated. One leader per sub-group is enforced at write time (the create path checks no other `active: true` leader exists for that sub-group), not via schema — deactivated leaders don't block provisioning a replacement.

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

  // Source: 'self' for public form, admin uid for admin-side add
  source: 'self' | string;         // 'self' or admin uid

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
On the public registration form, after the registrant picks a sub-group, query:
```
batches where subGroupId === picked AND status === 'OPEN' AND (amountReceived - amountAllocated) > 0
```
If any results, block submission with the council-leader message. Otherwise, allow.

The Cloud Function `registerParticipant` MUST repeat this check server-side — the client-side check is UX only. Admin-side "Add Participant" form bypasses this check by design (uses a separate Cloud Function `adminAddParticipant`).

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

## Security rules (with new public read for batches)

```
match /camps/{campId}/paymentBatches/{batchId} {
  // Limited public read: needed so the public registration form
  // can check for OPEN batches with unallocated balance.
  allow get: if true;
  allow list: if isAdmin();        // listing requires admin
  allow write: if isAdmin();
}
```
This is a trade-off: anyone with a camp ID can read individual batch docs. Acceptable since batches don't contain personal data — only sub-group name and amounts. If this becomes a concern, move the gating check into the Cloud Function and lock batches to admins only.

All other rules unchanged from prior spec.

## CSV formats unchanged
Roster: `participantId, fullName, phone, roomTypePreference, feeOwed, amountPaid`
Returned: same shape; only `participantId` and `amountPaid` are read.
