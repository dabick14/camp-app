# Rooming Spec — v1

## Mode
**ON-ARRIVAL only.** No pre-assignment in v1.

## Setup
1. Define room **types**: name, **price**, default capacity, overbook policy, order.
   - Examples from real-world taxonomy:
     - Condominium (GHS 50, capacity ~20, overbook ON)
     - 4-in-a-room with heater (GHS 200, capacity 4, overbook OFF)
     - 4-in-a-room without heater (GHS 150, capacity 4, overbook OFF)
     - Couple with heater (GHS 800, capacity 1, overbook OFF) — only registrant tracked
     - Couple without heater (GHS 500, capacity 1, overbook OFF) — only registrant tracked
     - Wise as Serpents (GHS 1000, capacity 1)
     - Good General (GHS 1500, capacity 1)
     - 24 Houses (GHS 1250, capacity 1) — apartments with multiple rooms, each room a separate "Room" doc
2. Define **rooms** via CSV bulk import (columns: number, type, gender, capacity, notes) or ad-hoc creation at the desk.

## Gender model
Every room is M or F. There's no mixed-gender flag. Couple rooms and 24 Houses-type rooms are capacity-1 rooms gendered by the registrant. The spouse or family stays outside the system.

## Payment gating
Rooming requires `paymentState in ['PAID', 'WAIVED']`. PENDING and PARTIAL are blocked **by default**, with an admin override path.

### Override path
If admin tries to assign a room to a PENDING or PARTIAL participant:
1. Modal: "⚠️ {Name} has outstanding balance: ₵{owedDiff}. Assign anyway?"
2. Required reason text input (e.g. "Leader confirms cash on hand", "Sponsorship being processed")
3. On confirm:
   - Set `participant.roomedWithoutFullPayment: true`
   - Set `participant.roomedWithoutFullPaymentNote: {reason}`
   - Proceed with normal assignment transaction
4. Audit fields (`roomAssignedBy`, `roomAssignedAt`) capture who did it

### Visibility
- Participant detail: red banner across the top if `roomedWithoutFullPayment === true`
- Participant list: a warning icon column or row highlight
- Dashboard: a top-line "Roomed with outstanding balance: N" counter
- All overrides surface in any CSV export of participants

This makes overrides explicit and uncomfortable, without making them impossible. Real-world camps need the escape hatch but should feel friction.

### Clearing the flag
Manual only. If a later payment brings the participant to PAID, the flag stays for audit. Admin can manually clear via participant detail ("Mark as resolved" — sets flag to false, keeps audit timestamp).

## Different-type override

The room picker filters to the participant's gender AND their registered room type by default — this is the safe path, so admins don't accidentally room someone into a type they didn't pay for. But when that type is full, reality needs an escape hatch.

1. Room picker has a "Show all room types" toggle (off by default). Turning it on widens the type filter; gender filtering is never relaxed.
2. Rooms of a non-matching type are visually marked in the list (group label badge + they're grouped separately from the registered type, which always sorts first).
3. If the admin picks a room whose type differs from the participant's registered type:
   - Confirm: "{Name} registered for {RegisteredType} but Room {Number} is a {ActualType}. Assign anyway?"
   - Required reason text input (e.g. "Premium full")
   - On confirm:
     - Set `participant.roomedInDifferentType: true`
     - Set `participant.roomedInDifferentTypeNote: {reason}`
     - Set `participant.roomedInDifferentTypeFrom: {registeredTypeName}`
     - `roomTypePreferenceId`, `roomTypePreferenceName`, and `feeOwed` are **not** touched — this is a placement, not a room-type change. Use the separate "Change Room Type" action when the fee should actually change (e.g. a real upgrade).
4. This stacks independently with the payment override above — a PENDING participant assigned a different type gets both flags and both reasons on record.

### Visibility
- Participant detail: amber banner (informational, not the red used for payment overrides — this is a service note, not a money error) showing registered-vs-actual type and the reason
- Participant list: a visible badge ("Diff. type"), always shown, not hover-only
- Dashboard: a "Roomed in different type: N" counter, amber/info styled (not the red "warn" treatment)
- No CSV export of participants exists yet in this codebase (only CSV *import*) — when one is built, it should include this flag, note, and registered-vs-actual type, same as the payment override.

### Clearing the flag
No clear action in v1 — unlike the payment override, this is a permanent placement record (what they registered for vs. what they actually got), useful at teardown to identify everyone who needs a service follow-up.

## Desk flow
Goal: paid participant standing at desk → roomed and counted in under 30 seconds.

```
1. Admin searches by name or phone (debounced 300ms)
2. Participant card shows:
   - Name, gender, age, sub-group, tags
   - Room type preference
   - Fee owed vs amount paid
   - Payment status badge (derived)
3. If PARTIAL or PENDING:
   - "Cannot room — owes ₵X" message
   - "Resolve payment" link → batch upload flow
   - "Override and assign anyway" button (uses path above)
4. If PAID or WAIVED:
   - "Assign Room" button enabled
5. Click Assign Room → room picker:
   - Filtered to participant's gender
   - Grouped by room type, sorted by order
   - Each row: number, occupancy ("18/20"), sub-groups of current occupants
   - At-capacity:
     * Overbookable: yellow, clickable, "OVER" badge
     * Hard-cap: greyed out
   - "+ Add new room" at top for ad-hoc
6. Admin picks. Toast: "Assigned to Room 204. Checked in."
```

## Soft overbook
- `allowOverbook && currentOccupancy >= capacity`:
  - Confirm modal "Room 204 is at capacity. Assign anyway?"
- `!allowOverbook && currentOccupancy >= capacity`:
  - Room disabled; transaction rejects if forced

## Sub-group visibility (info only)
Room picker shows sub-groups in each room ("3× Choir, 1× Youth"). Informational. Admins block off ranges manually.

## Undoing
- Participant detail → "Unassign Room": clears roomId, decrements currentOccupancy, does NOT revert check-in
- Separate "Undo Check-In" action if needed

## Room type changes
Changing room type:
- Updates `feeOwed` to new type's current price
- May flip derived `paymentState` to PARTIAL
- Does NOT auto-unassign current room
- Detail page warns of fee gap

## Capacity edge cases
- Capacity change doesn't affect existing rooms' occupancy
- Room deletion blocked if `currentOccupancy > 0`
- Room type deletion blocked if any rooms reference it OR any participants prefer it

## Out of v1
- Pre-assignment / auto-assignment rules
- Roommate requests
- Sub-group → room enforcement
- Family / mixed-gender rooms
- Print-on-assign badges
- Facilities damage report generation
