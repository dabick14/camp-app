# Data Model — Firestore

Subcollection structure. Keeps queries naturally scoped and security rules simple.

## Collections

```
/admins/{uid}                                  // Firebase Auth uid → admin record

/camps/{campId}
  /subGroups/{subGroupId}
  /roomTypes/{roomTypeId}
  /rooms/{roomId}
  /participants/{participantId}
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
Seeded manually via Firebase console for v1. Presence = full admin.

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
  maxParticipants?: number;        // soft cap, warn but don't block
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
  name: string;                    // "Dormitory", "Standard", "Premium"
  defaultCapacity: number;         // used when individual room has no override
  allowOverbook: boolean;          // true for dorms — warn but allow over capacity
  order: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `camps/{campId}/rooms/{roomId}`
```ts
{
  number: string;                  // "204", "A12", whatever the venue uses
  roomTypeId: string;
  roomTypeName: string;            // denormalized
  gender: 'M' | 'F';
  capacity: number;                // resolved from type default OR override
  currentOccupancy: number;        // maintained on every assignment/unassignment
  notes?: string;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy?: string;
}
```
- Room numbers are unique within a camp+gender. Validate on create.
- `currentOccupancy` is the source of truth for capacity checks. Updated in a transaction with the participant write.

### `camps/{campId}/participants/{participantId}`
```ts
{
  // Identity
  fullName: string;
  phone: string;
  email?: string;
  gender: 'M' | 'F';
  dateOfBirth?: Timestamp;         // OR age — pick one and stick with it
  age?: number;                    // captured if DOB not given
  emergencyContactName?: string;
  emergencyContactPhone?: string;

  // Sub-group (required, exactly one)
  subGroupId: string;
  subGroupName: string;            // denormalized

  // Tags (free-form, admin-added)
  tags: string[];                  // default []

  // States — keep these separate, flat strings
  registrationState: 'REGISTERED' | 'CANCELLED';
  paymentState: 'PENDING' | 'PAID' | 'WAIVED';
  checkInState: 'NOT_ARRIVED' | 'ARRIVED';

  // Room assignment
  roomId?: string;
  roomNumber?: string;             // denormalized
  roomAssignedBy?: string;
  roomAssignedAt?: Timestamp;

  // Payment audit
  paymentAmount?: number;
  paymentMethod?: string;          // free-text for v1: "Cash", "MoMo to John", etc.
  paymentConfirmedBy?: string;
  paymentConfirmedAt?: Timestamp;
  paymentNotes?: string;

  // Check-in audit
  checkedInBy?: string;
  checkedInAt?: Timestamp;

  // General
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  updatedBy?: string;              // 'self' for self-registration, admin uid otherwise
}
```

## State transition rules
- Registration is created at `REGISTERED` + `PENDING` + `NOT_ARRIVED`.
- `paymentState` can move PENDING ↔ PAID, or → WAIVED.
- `roomId` can only be set when `paymentState === 'PAID'` or `'WAIVED'`.
- Setting `roomId` also sets `checkInState = 'ARRIVED'` in the same transaction.
- Unsetting `roomId` does NOT auto-revert check-in. Admin must undo check-in separately.
- `registrationState = 'CANCELLED'` is a soft delete. Cancelled participants are excluded from dashboard counts but remain in the database.

## Room assignment transaction
Assigning a room must be transactional:
```
1. Read room — confirm exists, matches participant gender
2. If currentOccupancy >= capacity:
     - If roomType.allowOverbook: warn UI, proceed
     - Else: abort with error
3. If participant already has a roomId: decrement that room's currentOccupancy first
4. Write participant: roomId, roomNumber, roomAssignedBy/At, checkInState=ARRIVED, checkedInBy/At
5. Increment new room's currentOccupancy
```
Wrap in a Firestore transaction or run a Cloud Function. The transaction prevents two admins double-booking the same dorm slot.

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
      allow write: if false;  // console only
    }

    match /camps/{campId} {
      allow read: if isAdmin();
      allow write: if isAdmin();

      match /subGroups/{subGroupId} {
        allow read: if true;             // public — needed for registration form
        allow write: if isAdmin();
      }

      match /roomTypes/{roomTypeId} {
        allow read, write: if isAdmin();
      }

      match /rooms/{roomId} {
        allow read, write: if isAdmin();
      }

      match /participants/{participantId} {
        allow read, update, delete: if isAdmin();

        // Public CREATE for self-registration
        allow create: if
          request.resource.data.registrationState == 'REGISTERED'
          && request.resource.data.paymentState == 'PENDING'
          && request.resource.data.checkInState == 'NOT_ARRIVED'
          && request.resource.data.tags.size() == 0
          && request.resource.data.roomId == null
          && request.resource.data.fullName is string
          && request.resource.data.phone is string
          && request.resource.data.subGroupId is string
          && request.resource.data.gender in ['M', 'F']
          && get(/databases/$(db)/documents/camps/$(campId)).data.registrationOpen == true;
      }
    }
  }
}
```

## Indexes you'll likely need
- `participants` by `subGroupId` + `paymentState`
- `participants` by `subGroupId` + `checkInState`
- `participants` by `registrationState` + `paymentState`
- `rooms` by `gender` + `roomTypeId`

Firestore will prompt — let it.

## App Check
Required before going public. reCAPTCHA v3 provider in browser. Dry-run during dev, enforce before deploy.

## CSV export shape
Single flat file. One row per participant. Columns:
`fullName, phone, email, gender, age, subGroupName, registrationState, paymentState, checkInState, roomNumber, tags (semicolon-separated), createdAt, paymentConfirmedAt, checkedInAt`

Export from participant list page, respects current filters.
