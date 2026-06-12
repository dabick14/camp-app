# Rooming Spec — v1

## Mode
**ON-ARRIVAL only.** No pre-assignment workflow in v1.

## Setup
1. Admin defines room **types** for the camp: name, **price**, default capacity, overbook policy, order.
   - Typical: Dormitory (₵250, default 20, overbook ON), Standard (₵400, default 4, overbook OFF), Premium (₵600, default 2, overbook OFF).
2. Admin defines **rooms** via CSV bulk import or ad-hoc creation:
   - CSV columns: `number, type, gender, capacity, notes`. Capacity blank → type default.
   - Ad-hoc form at the desk for unexpected room numbers.

## Payment gating
Rooming is **blocked** unless `paymentState in ['PAID', 'WAIVED']`.
- `PENDING` → cannot room
- `PARTIAL` → cannot room (must pay the difference first)
- `PAID` → can room
- `WAIVED` → can room

Derived from `amountPaid >= feeOwed` (see PAYMENTS_SPEC.md).

## Desk flow
Goal: paid participant standing at desk → roomed and counted in **under 30 seconds**.

```
1. Admin searches by name or phone.
2. Participant card shows:
   - Name, gender, age, sub-group
   - Room type preference
   - Fee owed vs amount paid (e.g. "₵400 / ₵400 ✓")
   - Payment status badge (derived)
3. If PARTIAL or PENDING: card shows "Cannot room — owes ₵X". No "Assign Room" button.
   - Admin can resolve by uploading an allocations CSV or recording a new batch (link visible).
   - Or admin can manually set feeOwed (waive) with a note.
4. If PAID or WAIVED: "Assign Room" button is enabled.
5. Clicking opens a room picker:
   - Filtered to participant's gender
   - Grouped by room type, sorted by order
   - Each row: number, occupancy (e.g. "18/20"), sub-groups of current occupants
   - At-capacity rooms:
     * Overbookable types: yellow, clickable, "OVER" badge
     * Hard-cap types: greyed out
   - Top of list: "+ Add new room" for ad-hoc creation
6. Admin picks. Confirmation toast: "Assigned to Room 204. Checked in."
```

## Soft overbook
- `roomType.allowOverbook && currentOccupancy >= capacity`:
  - Room shown with warning
  - Click → confirm dialog "Room 204 is at capacity. Assign anyway?"
  - Proceeds on confirm
- `!roomType.allowOverbook && currentOccupancy >= capacity`:
  - Room disabled
  - Defensive: transaction rejects if forced

## Sub-group visibility (not enforcement)
Room picker shows sub-groups of current occupants per room ("Currently: 3× Choir, 1× Youth"). Informational. Admins block off ranges manually if needed.

## Undoing
- Participant detail page → "Unassign Room"
  - Clears roomId, roomNumber, audit fields
  - Decrements old room's currentOccupancy
  - Does NOT auto-revert check-in
- Separate "Undo Check-In" button if needed

## Room type changes after payment
See PAYMENTS_SPEC.md. Changing room type:
- Updates `feeOwed` to new type's current price
- Does NOT auto-recompute `amountPaid`
- May flip derived `paymentState` to PARTIAL
- If participant was in an OLD-type room, they keep that room until admin manually moves them
- Admin sees a prominent "fee gap" warning until resolved

## Capacity edge cases
- Capacity change (20 → 24): `currentOccupancy` unchanged. New picks against new capacity.
- Room deletion: blocked if `currentOccupancy > 0`. Unassign first.
- Room type deletion: blocked if any rooms reference it OR any participants prefer it.

## What's deliberately NOT in v1
- Pre-assignment / auto-assignment rules
- Roommate requests
- Sub-group → room enforcement
- Family / mixed-gender rooms
- Print-on-assign badges
