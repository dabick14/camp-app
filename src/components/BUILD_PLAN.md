# Build Plan — Updated

You are partway through. Day 0 done, Day 1 done, Day 2 in flight (room types + rooms). Payments scope has grown significantly. This is the revised plan.

## Where you are
- ✅ Day 0: Firebase, Vite, App Check, seeded admins, ProtectedRoute
- ✅ Day 1: Camps + sub-groups CRUD
- 🔄 Day 2: Room types + rooms (in progress)

## What changed since the original plan
- Room types now have a `price` field
- Participants now have `roomTypePreferenceId` + `feeOwed`
- Public registration must show room type prices and capture preference
- New payment system: batches + allocations + CSV roundtrip
- New public stats page
- Tags and CSV-export-of-participants are OUT of v1

## Revised days

### Day 2 (in flight) — Room Types + Rooms
**One small addition:** add a `price` field (number, required) to the room type form. Otherwise build as previously prompted.

### Day 2.5 — Retrofit Day 1 (small, ~1 hour)
- Confirm `currency: 'GHS'` field exists on camp doc (add to create/edit form if missing)
- Verify room type price is captured and stored
- No other Day 1 changes needed

### Day 3 — Public Registration
- Route: `/r/:campId`, no auth
- Renders only if `registrationOpen === true`
- Fetches camp + sub-groups + room types (public read)
- Fields: full name, phone, email, gender, DOB or age, emergency contact, sub-group picker, **room type picker showing prices**
- On submit (via Cloud Function for security): write participant doc with
  - Initial states (REGISTERED, NOT_ARRIVED)
  - `subGroupId` + `subGroupName`
  - `roomTypePreferenceId` + `roomTypePreferenceName`
  - `feeOwed` = price of selected room type at time of registration
  - `amountPaid: 0`
- `/r/:campId/done` confirmation page
- Mobile-friendly

**Done when:** end-to-end registration on a phone produces a correctly-shaped participant doc with feeOwed set.

### Day 4 — Participant List + Desk Flow (room assignment)
- `/admin/camps/:id/participants` — table with columns: name, phone, gender, sub-group, room type, fee status (paid/owed display), check-in, room
- Filters: sub-group, payment status (computed), check-in status, room type
- Search: name OR phone (client-side OK for now)
- Row click → detail drawer
- Drawer actions:
  - Assign Room (gated by paymentState; opens picker per ROOMING_SPEC)
  - Unassign Room
  - Undo Check-In
  - Cancel registration
  - **Change room type** (updates feeOwed)
  - **Waive fee** (sets feeOwed = 0, requires note)
- Room picker per ROOMING_SPEC — transactional writes

**Done when:** paid participants can be assigned rooms via the desk flow in <30s, and unpaid participants are correctly blocked.

### Day 5 — Payment Batches (the big one)
This is now the most complex day. ~1.5 to 2 days of work compressed into "Day 5." Be honest with yourself about pace; if it spills into Day 6, cut from the polish list.

Part A — Batch CRUD:
- `/admin/camps/:id/payments` — landing page
- Top summary table: per-sub-group counts (registered, paid, partial, pending) + amounts (received, expected)
- Batch list with filters and status badges
- "New Batch" form → creates batch with auto-generated reference code

Part B — Roster CSV generation:
- On batch detail, "Download Roster" button
- Generates CSV scoped to that sub-group, includes participantId
- Plain `download` of a Blob, no server needed

Part C — Allocations upload:
- On batch detail, "Upload Allocations" file picker
- Parses with papaparse
- Validates each row (ID exists, in sub-group, amount valid)
- Preview screen: valid / warnings / errors
- Confirm → ONE Firestore transaction that:
  - Creates allocation docs
  - Updates each participant's `amountPaid`
  - Updates batch's `amountAllocated`
  - Aborts on overspend

Part D — Reconciliation + voiding:
- Mark Reconciled (with or without variance note)
- Reopen if needed
- Void allocation from participant detail (reverses amountPaid)

**Done when:** can record a ₵5000 batch, generate roster, simulate a filled-in CSV, upload, see participants flip to PAID, mark reconciled.

### Day 6 — Dashboard + Public Stats + Polish
- `/admin/camps/:id` — camp dashboard
  - Top cards: total registered, paid, partial, pending, roomed
  - Per sub-group table
- `/stats/:campId` — public read-only aggregate page
  - Same shape, no names, accessible without auth
- Flip App Check to enforce
- Final security rules pass — test rejected paths in rules playground
- Loading states, empty states, error toasts
- Deploy to Firebase Hosting

### Day 7 — Dogfood Buffer
- Seed a fake camp with ~100 participants, 50 rooms, 5 batches
- Time desk flow + batch upload flow
- Fix worst friction
- Write a 1-page admin cheat sheet

## Honest timeline check
You're now looking at ~5 more build days (Day 2 finish → Day 6) plus a buffer day. Payments adds real complexity. If anything slips, cut from this list, in this order:

1. Variance acknowledgment workflow (just allow reconcile with a single note)
2. Void allocations (admin uses Firestore console)
3. Reopening reconciled batches
4. Filter by date range on batch list
5. Per-sub-group summary table on payments page (keep on dashboard only)
6. Mobile responsiveness on admin pages (registration page MUST be mobile; rest can be desktop-only)

## What to NOT cut
- Payment gating on rooming (PAID/WAIVED only)
- Transactional allocation writes (data integrity)
- Public registration mobile UX
- App Check enforce + security rules
- Audit fields on writes
- Roster CSV download (the heart of the payment flow)

## Scale concern (parking lot for camp 1)
The scale-pass (pagination, server-side filtering, aggregation) is deferred. The current design will likely struggle past 1000-1500 participants in the list view and dashboard. For camp 1 with 3000 registrants, expect to:
- Limit participant list to one sub-group at a time (filter required, no "show all")
- Tolerate dashboard taking 3-5 seconds to load
- Cache aggregate counts on the camp doc and update via a daily cron OR Cloud Function trigger (phase 2)

If real performance during dogfooding is unworkable, address it before camp day with the smallest possible change (probably: paginate participant list, cache aggregate counts).
