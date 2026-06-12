# Data Model — Firestore

Subcollection structure. Queries naturally scoped, security rules simple.

## Collections

```
/admins/{uid}

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
  maxParticipants?: number;        // soft cap
  currency: string;                // "GHS" for now
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
  price: number;                   // fee charged for this type
  defaultCapacity: number;
  allowOverbook: boolean;
  order: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

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
  // Identity
  fullName: string;
  phone: string;
  email?: string;
  gender: 'M' | 'F';
  dateOfBirth?: Timestamp;
  age?: number;
  emergencyContactName?: string;
  emergencyContactPhone?: string;

  // Sub-group
  subGroupId: string;
  subGroupName: string;

  // Room type preference (set at registration, drives fee)
  roomTypePreferenceId: string;
  roomTypePreferenceName: string;
  feeOwed: number;                 // locked at registration; updates only when room type changes

  // Registration & check-in states (FLAT strings)
  registrationState: 'REGISTERED' | 'CANCELLED';
  checkInState: 'NOT_ARRIVED' | 'ARRIVED';
  // NOTE: paymentState is DERIVED, not stored. Compute from allocations.

  // Room assignment (set on assignment, blocked unless paid)
  roomId?: string;
  roomNumber?: string;
  roomAssignedBy?: string;
  roomAssignedAt?: Timestamp;

  // Cached payment total for fast reads (kept in sync via allocation writes)
  amountPaid: number;              // default 0; updated transactionally with allocations

  // Check-in audit
  checkedInBy?: string;
  checkedInAt?: Timestamp;

  // General
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  updatedBy?: string;
}
```

**Deriving `paymentState`** (computed in the UI, not stored):
- `amountPaid >= feeOwed` → `PAID`
- `0 < amountPaid < feeOwed` → `PARTIAL`
- `amountPaid === 0` → `PENDING`
- `feeOwed === 0` (admin waived) → `WAIVED`

### `camps/{campId}/paymentBatches/{batchId}`
```ts
{
  referenceCode: string;           // human-readable: "CHOIR-042"
  subGroupId: string;
  subGroupName: string;            // denormalized
  amountReceived: number;
  amountAllocated: number;         // sum of allocations; kept in sync
  method: 'MOMO' | 'CASH' | 'BANK' | 'OTHER';
  externalReference?: string;      // MoMo TXID, bank ref, etc.
  receivedAt: Timestamp;
  receivedBy: string;              // admin uid who recorded the batch
  notes?: string;
  status: 'OPEN' | 'RECONCILED';   // OPEN = unallocated funds remain; RECONCILED = admin closed it
  varianceAcknowledged: boolean;   // true if admin closed with amountAllocated != amountReceived
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Reference code generation: `{SUBGROUP_PREFIX}-{SEQUENCE}` where prefix is the first 5 alphanumeric chars of sub-group name uppercased, and sequence is a per-camp counter. Collision check on write.

### `camps/{campId}/allocations/{allocationId}`
```ts
{
  batchId: string;
  participantId: string;
  participantName: string;         // denormalized for audit
  amount: number;
  createdAt: Timestamp;
  createdBy: string;
  // No update path — allocations are immutable. To correct, void + re-create.
  voided: boolean;                 // soft-delete
  voidedBy?: string;
  voidedAt?: Timestamp;
  voidReason?: string;
}
```

## Transactions you MUST get right

### Creating allocations from a CSV upload
Wrap in a single Firestore transaction OR a Cloud Function:
```
1. Read batch, confirm status === 'OPEN'
2. For each row:
   a. Read participant doc
   b. Create allocation doc (immutable record)
   c. Increment participant.amountPaid by row.amount
3. Increment batch.amountAllocated by sum of rows
4. If batch.amountAllocated > batch.amountReceived: abort (overspend)
```
The whole upload must succeed or fail atomically. No partial writes.

### Voiding an allocation
```
1. Read allocation, confirm not already voided
2. Set allocation.voided = true (audit)
3. Decrement participant.amountPaid by allocation.amount
4. Decrement batch.amountAllocated by allocation.amount
5. If batch was RECONCILED, set back to OPEN
```

### Assigning a room
```
1. Read participant. Verify derived paymentState in ['PAID', 'WAIVED'].
2. Read room. Verify exists, matches participant gender.
3. If currentOccupancy >= capacity:
     - If roomType.allowOverbook: warn UI, proceed
     - Else: abort
4. If participant.roomId exists: decrement old room's currentOccupancy
5. Write participant: roomId, roomNumber, roomAssignedBy/At, checkInState=ARRIVED, checkedInBy/At
6. Increment new room's currentOccupancy
```

### Updating room type (changes fee)
```
1. Read new roomType, capture current price
2. Write participant: roomTypePreferenceId, roomTypePreferenceName, feeOwed = newType.price
3. Recompute participant.paymentState in UI (derived; may now be PAID, PARTIAL, or PENDING)
4. If participant had a roomId of the OLD type, do NOT auto-unassign. Admin must manually re-room.
```

## Security rules (sketch)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function isAdmin() {
      return request.auth != null
          && exists(/databases/$(db)/documents/admins/$(request.auth.uid));
    }

    match /admins/{uid} {
      allow read: if isAdmin();
      allow write: if false;
    }

    match /camps/{campId} {
      allow read: if isAdmin() || resource.data.registrationOpen == true;
      allow write: if isAdmin();

      match /subGroups/{subGroupId} {
        allow read: if true;                // public for registration form
        allow write: if isAdmin();
      }

      match /roomTypes/{roomTypeId} {
        allow read: if true;                // public — needed to show prices on reg form
        allow write: if isAdmin();
      }

      match /rooms/{roomId} {
        allow read, write: if isAdmin();
      }

      match /participants/{participantId} {
        allow read, update, delete: if isAdmin();

        // Public CREATE for self-registration
        allow create: if
          request.resource.data.registrationState == 'REGISTERED'
          && request.resource.data.checkInState == 'NOT_ARRIVED'
          && request.resource.data.amountPaid == 0
          && request.resource.data.roomId == null
          && request.resource.data.fullName is string
          && request.resource.data.phone is string
          && request.resource.data.subGroupId is string
          && request.resource.data.roomTypePreferenceId is string
          && request.resource.data.gender in ['M', 'F']
          && get(/databases/$(db)/documents/camps/$(campId)).data.registrationOpen == true;
      }

      match /paymentBatches/{batchId} {
        allow read, write: if isAdmin();
      }

      match /allocations/{allocationId} {
        allow read, create: if isAdmin();
        allow update: if isAdmin();         // void path
        allow delete: if false;             // never hard-delete allocations
      }
    }
  }
}
```

## Indexes you'll need
- `participants` by `subGroupId` + `registrationState`
- `participants` by `gender` + `registrationState`
- `participants` by `roomId` (for occupancy reverse lookups)
- `allocations` by `participantId` + `voided`
- `allocations` by `batchId` + `voided`
- `paymentBatches` by `subGroupId` + `status`

## Public stats page derivation
For `/stats/:campId`, fetch from camp's collections:
- Total registered = count of participants where `registrationState === 'REGISTERED'`
- Total paid = count where `amountPaid >= feeOwed AND feeOwed > 0`
- Total roomed = count where `roomId != null`
- Per sub-group: same three counts grouped by `subGroupId`

For v1, do this client-side with a single bulk read per page load. Scale-pass later if needed.

## CSV formats

### Roster CSV (generated by admin, sent to leader)
```
participantId,fullName,phone,roomTypePreference,feeOwed,amountPaid
{uuid},John Doe,0244111222,Standard,400,
{uuid},Jane Doe,0244333444,Premium,600,
```
The `amountPaid` column is empty. Leader fills it in. They should not edit other columns.

### Allocations CSV (returned by leader, uploaded by admin)
Same shape as roster CSV. System ignores all columns except `participantId` and `amountPaid`. Rows with empty `amountPaid` are skipped. Rows where `participantId` doesn't exist in this sub-group are flagged as errors.
