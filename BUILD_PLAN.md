# Build Plan — Updated

## Where you are
- ✅ Day 0: Setup, App Check, seeded admins
- ✅ Day 1: Camps + sub-groups CRUD
- ✅ Day 2 + 2.5: Room types (with price) + rooms + currency on camp
- ✅ Day 3: Public registration + Cloud Function + done page
- 🔄 Day 4a: Layout + read-only views (in flight)
- Upcoming: 4b, 4c, scale checkpoint, 5, 6, 7

## What changed since the last plan
- Emergency contact fields dropped from form/model
- Tags formally back in v1 (was deferred earlier)
- Admin-side "Add Participant" form added to scope
- Reconciliation-gates-registration rule added (blocks new public registrations for sub-groups with unreconciled batches)
- Override visibility on rooming PENDING/PARTIAL participants added
- Dashboard expanded with room-type × gender breakdown
- Capacity-1 room types (couple, 24 Houses) accommodated naturally — no schema change

## Days

### Day 4a — Layout + read-only views (IN FLIGHT)
No changes. Let it complete. The tag field and override flag already exist in the schema, so the participant table will render whatever's present without modification.

### Day 4a.5 — Form cuts (after 4a passes tests)
Tiny session, ~30 min:
- Remove emergency contact name + phone fields from public registration form
- Remove from Cloud Function payload + Firestore write
- Remove fields from participant TypeScript type (or mark as legacy if existing participants have them)
- Update detail drawer to drop these from display

### Day 4b — Tags + Non-rooming mutations + Admin Add Participant
- Tags management in participant detail drawer (chip input, add/remove)
- Filter by tag on participant list (multi-select)
- Detail drawer action buttons (read-only drawer becomes interactive):
  - Cancel Registration (with confirmation)
  - Undo Check-In
  - Change Room Type (with feeOwed recompute warning)
  - Waive Fee (sets feeOwed = 0, requires note)
  - Edit notes
- **Admin-side "Add Participant" form** at `/admin/camps/:id/participants/new`
  - Same fields as public form
  - Uses new `adminAddParticipant` Cloud Function (bypasses registrationOpen + reconciliation-gate checks)
  - Sets `source` to the admin's uid

### Day 4c — Room assignment desk flow + Override visibility
- Room picker per ROOMING_SPEC.md (filtered, grouped, overbook handling)
- Assign Room button gated by paymentState (PAID/WAIVED only)
- **Override path for PENDING/PARTIAL:** confirmation modal, required reason, sets `roomedWithoutFullPayment` flag
- Banner on participant detail when flag is set
- Dashboard adds "Roomed with outstanding balance: N" counter
- Unassign Room action
- Ad-hoc room creation inline in the picker

### Day 4.5 — Scale checkpoint
Before Day 5. Seed ~500 fake participants + ~50 rooms + a few batches via a script. Click through every Day 4 screen. Capture:
- Any Firestore index errors → create them
- Slow loads → note specifics
- Decide:
  - Dashboard derive live vs cache?
  - Participant list paginate vs virtualize?
  - Search client-side vs server-side?

Make minimum changes to support 3000 expected scale. Don't pre-optimize.

### Day 5 — Payments
- `/admin/camps/:id/payments` landing
- Per-sub-group summary table with reconciliation status indicator (✅/⚠️)
- Batch CRUD + reference code generation
- Roster CSV download
- Allocations CSV upload (transactional, with preview)
- Reconciliation + variance acknowledgment
- Void allocations from participant detail
- **Registration gating implementation:**
  - Public form queries OPEN batches with non-zero balance on sub-group select
  - Shows blocker message + disables submit
  - `registerParticipant` Cloud Function re-checks server-side
  - `adminAddParticipant` Cloud Function bypasses

### Day 6 — Dashboard polish + Public stats + Deploy
- Full dashboard with:
  - Top cards (registered, paid, partial, pending, roomed, overrides)
  - Per sub-group table (counts + amounts)
  - Per room-type table (capacity, occupied, preferred)
  - Per room-type × gender breakdown (NEW, mirrors your historical sheet)
  - Per gender summary
- `/stats/:campId` public page — same shape, no names
- Flip App Check to enforce
- Final security rules pass
- Loading, empty, error states
- Deploy

### Day 7 — Dogfood Buffer
- Seed ~100 participants, 50 rooms, 5 batches
- Time desk flow + batch upload
- Fix worst friction
- Admin cheat sheet (1 page)

## Honest timeline
You're 3 days in, with 5-6 build days left (4a, 4a.5, 4b, 4c, 4.5, 5, 6, 7). At 1 day per phase that's ~7-8 calendar days. With slip, maybe 10. Camp is first week of July.

**Tuesday deadline (registration goes live):** only needs Day 4a + 4a.5 + deployed registration form. Day 4b through 6 happen DURING registration window. Day 5 (payments) is needed by ~2 weeks before camp.

## Cut list (in order, if running out of time)
1. Override "Mark as resolved" clearing (admin lives with persistent flag)
2. Void allocations UI (Firestore console as backup)
3. Reopening reconciled batches UI (console backup)
4. Per-gender dashboard breakdown (Day 6 polish)
5. Tag filter on participant list (have tags, just no filter)
6. Variance acknowledgment workflow (just allow reconcile with note)

## What to NOT cut
- Payment gating (PAID/WAIVED for rooming) + the override path
- Reconciliation-gates-registration rule
- Transactional allocation writes
- Public registration mobile UX
- App Check enforce + security rules
- Audit fields on writes
- Roster CSV download
- Admin Add Participant escape hatch
