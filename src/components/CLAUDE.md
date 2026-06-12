# Camp App — Project Context

## What this is
An internal operations app for running church camps. Reduces chaos around registration, manual payment reconciliation, on-arrival room assignment, and check-in.

## What this is NOT
- A church management system
- A long-term ERP
- A perfect accounting platform
- A payment gateway

Guiding rule: **if it doesn't reduce chaos during camp, it doesn't belong.**

## Stack
- Vite + React + TypeScript
- Firebase: Firestore, Auth, Hosting, App Check
- No backend server — Firestore SDK directly from the client where possible
- Cloud Functions only where security demands it (public registration write path)
- Tailwind + shadcn/ui for styling
- `papaparse` for CSV parsing

## Users (v1)
- **Admin** — full authority. Multiple admins, all equal. Identified by presence in `/admins/{uid}` collection. Seeded manually in Firebase console.
- **Registrant** — fills public registration form. No account, no login.
- **Sub-group leader** — has no system access. Interacts via CSVs the admin sends them and they send back.

No tiered roles. No attendee self-service. No leader portal.

## Core concepts
- **Camp** — top-level container. Everything is scoped to a camp.
- **SubGroup** — admin-defined groups within a camp (e.g. "Youth Council", "Choir"). Registrants pick exactly ONE on signup. Drives reporting and payment batches.
- **Participant** — a registrant within a camp. Holds payment state, check-in state, room assignment, sub-group, and a fee owed.
- **RoomType** — admin-defined per camp. Has a **price**, default capacity, overbook policy.
- **Room** — a specific room within a camp. Number, type, gender (M/F), capacity.
- **PaymentBatch** — a lump-sum payment received from a sub-group (typically by MoMo). Has a unique reference code. Money is allocated from it to specific participants.
- **Allocation** — a record that some amount from a batch covers a specific participant's fee. Sum of allocations to a participant determines their `paymentState`.

## Locked decisions

### Auth & admins
- Firebase Auth email/password. No custom JWT.
- Presence in `/admins` = full access. Seeded via console.

### Sub-groups & tags
- One required sub-group per participant. Created during camp setup.
- Tags deferred to phase 2.

### Payments (the big one)
- Manual entry only in v1. No aggregator integration.
- Two-layer reality: participants pay sub-group leaders → leaders pay central admin in lump sums.
- Central admin records each lump sum as a **PaymentBatch** with a unique reference code (`CHOIR-042`).
- For each batch, admin **generates a roster CSV** for that sub-group (pre-populated with participant IDs, names, phones, fee owed).
- Admin sends CSV to leader via whatever channel (WhatsApp, email). Leader fills in `amountPaid` column per person and sends back.
- Admin **uploads the returned CSV** against the batch. System matches by `participantId` (exact, not fuzzy). Each row becomes an Allocation.
- Sum of allocations must match batch amount (or admin acknowledges variance with a note).
- `paymentState` is **derived**: PAID (allocations ≥ feeOwed), PARTIAL (some but < feeOwed), PENDING (zero).

### Fees
- Each room type has a `price`.
- Participant has `feeOwed`, set when their room type is set/changed.
- Pattern: fee locks at registration (based on chosen room type), updates only when room type explicitly changes.

### Rooming
- ON-ARRIVAL only. Pre-assignment is phase 2.
- Assigning a room implicitly checks the participant in.
- Capacity defined per room, defaults from type.
- Soft overbook on dormitories (allowed with warning). Hard cap elsewhere.
- Gender enforced at room level: M or F only.
- Rooming blocked unless `paymentState === 'PAID'` or `'WAIVED'`. PARTIAL = no room.

### Public stats
- Aggregate-only public stats page (`/stats/:campId`) — totals + per-sub-group counts, no names.
- Replaces the old "shared Google Sheet" pattern leaders used to rely on.

## v1 scope (build this, nothing more)
1. Admin auth (seeded admins)
2. Create/edit a camp
3. Sub-groups for a camp
4. Room types with prices
5. Rooms management (form + CSV bulk import)
6. Public registration with room type preference (sets feeOwed)
7. Participant list with filters and search
8. **Payment batches:** create batch, generate roster CSV, upload allocations CSV, confirm
9. Admin actions: assign room (= check in), unassign, undo check-in, cancel, override fee
10. Per-camp dashboard: counts per sub-group (registered, paid, partial, roomed)
11. Public aggregate stats page

## Phase 2 (explicitly OUT of v1)
- Payment aggregators (Paystack, MoMo direct)
- Pre-assigned rooming workflow
- Sub-group leader portal (magic links, logins)
- Tags
- Attendee mobile self-service
- Scoped admin roles
- Cloning previous camps
- Scale-pass optimization (we'll do this AFTER payments, depending on observed performance)

## Coding conventions
- Small, dumb components. Data fetching at route level.
- Firestore modular SDK directly. No abstraction layer.
- One state field per participant per concern: `registrationState`, `checkInState`. **`paymentState` is derived, NOT stored** — compute from allocations.
- Flat UPPERCASE state values matching DATA_MODEL.md exactly.
- All admin writes set `updatedAt` + `updatedBy`. Soft-delete (cancel), never destroy.
- Denormalize names for cheap reads: `subGroupName` on participant, `roomTypeName` on room, `roomNumber` on participant.
- File organization: `src/features/{feature}/` co-located.
- No state machine library. Plain string fields + explicit transition functions.

## When in doubt
- Cut features rather than add them.
- Choose boring over clever.
- If a feature isn't on the v1 list, push back before building.
