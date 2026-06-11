# Rooming Spec — v1

## Mode
**ON-ARRIVAL only.** No pre-assignment workflow in v1. Pre-assignment is phase 2.

## Setup flow (done during camp setup)
1. Admin defines room **types** for the camp: name, default capacity, overbook policy, order.
   - Typical: Dormitory (default 20, overbook ON), Standard (default 4, overbook OFF), Premium (default 2, overbook OFF).
2. Admin defines **rooms** in two ways:
   - **Bulk CSV import** when the venue sends the list. Columns: `number, type, gender, capacity, notes`. Capacity is optional — blank means use type default.
   - **Ad-hoc creation at the desk** when a room number wasn't in the import. Quick-add form pops up inline.

## Desk flow (the critical one)
Goal: participant standing at desk → assigned and counted in **under 30 seconds**.

Single page: `/admin/camps/:id/desk` (or just the participant list with a "Desk" action).

```
1. Admin searches by name or phone.
2. Participant card shows:
   - Name, gender, age, sub-group
   - Payment status (badge)
   - Room status (badge)
3. If unpaid: inline "Mark Paid" button. Amount + method optional. Click → PAID.
4. Once paid: "Assign Room" button is enabled.
5. Clicking Assign Room opens a room picker:
   - Filtered to participant's gender
   - Grouped by room type, sorted by `order`
   - Each row shows: number, occupancy (e.g. "18/20"), sub-groups currently in room
   - Rooms at capacity are visually distinct:
     * Overbookable types: yellow, still clickable, shows "OVER" badge
     * Hard-cap types: greyed out, not clickable
   - Top of list: "+ Add new room" for ad-hoc creation
6. Admin picks a room. Confirmation toast: "Assigned to Room 204. Checked in."
7. Done. Move to next person.
```

## Overbook behavior
- If `roomType.allowOverbook === true` and `currentOccupancy >= capacity`:
  - UI shows the room as available but flagged
  - Clicking it shows a confirm dialog: "Room 204 is at capacity. Assign anyway?"
  - Proceeds on confirm
- If `roomType.allowOverbook === false` and `currentOccupancy >= capacity`:
  - Room is disabled in picker
  - If clicked anyway (shouldn't happen but defensive), transaction rejects

## Sub-group visibility (not enforcement)
- Room picker shows sub-groups of current occupants per room ("Currently: 3× Choir, 1× Youth")
- This is informational only — admins can block off ranges in their head ("Choir gets 200-220")
- System does NOT enforce sub-group + room rules in v1

## Undoing assignments
- Participant detail page shows current room with an "Unassign" button
- Unassigning:
  - Clears `roomId`, `roomNumber`, `roomAssignedBy/At`
  - Decrements old room's `currentOccupancy`
  - Does NOT auto-revert check-in (admin must explicitly undo check-in)
  - This decoupling matters: someone might switch rooms but stay checked in

## Capacity edge cases
- Capacity changes (admin edits a room from 20 → 24): `currentOccupancy` is unaffected. New picks against new capacity.
- Room deletion: blocked if `currentOccupancy > 0`. Admin must unassign first.
- Room type deletion: blocked if any rooms reference it.

## What's deliberately NOT in v1
- Pre-assignment / auto-assignment rules
- Roommate requests
- Room move history beyond audit fields
- Sub-group → room enforcement
- Capacity warnings before the camp starts
- Family rooms / mixed gender
- Room pricing / billing
- Print-on-assign badge generation
