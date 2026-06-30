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
- Cloud Functions only where security demands it (public registration write path)
- Tailwind + shadcn/ui for styling
- `papaparse` for CSV parsing

## Users (v1)
- **Admin** — full authority. Multiple admins, all equal. Identified by presence in `/admins/{uid}`.
- **Registrant** — fills public registration form. No account.
- **Sub-group / council leader** — no system access. Interacts via CSVs the admin sends and they send back.

No tiered roles. No attendee self-service. No leader portal.

## Core concepts
- **Camp** — top-level container. Everything is scoped to a camp.
- **SubGroup** — admin-defined groups (referred to operationally as "councils"). Registrants pick exactly ONE on signup.
- **Tag** — free-form labels admins add to participants AFTER registration. Multiple per participant. Used for further subdivision within a sub-group (e.g. "Worker", "Group A", "First-timer").
- **Participant** — a registrant within a camp.
- **RoomType** — admin-defined per camp. Has price, default capacity, overbook policy. Capacity-1 types (couple rooms, 24 Houses-style) follow the registrant's gender; the spouse/family is outside the system's view.
- **Room** — number, type, gender, capacity.
- **PaymentBatch** — lump-sum payment received from a sub-group with a unique reference code.
- **Allocation** — record that some money from a batch covers a specific participant's fee. Sum determines payment state.

## Locked decisions

### Auth & admins
- Firebase Auth email/password.
- Presence in `/admins` = full access. Seeded via console.

### Sub-groups & tags
- One required sub-group per participant. Created during camp setup.
- Tags are in v1: multi-tag, admin-managed, used for subdivision and CSV filtering.

### Payments
- Manual entry only in v1.
- Two-layer reality: participants pay sub-group leaders → leaders pay central admin in lump sums.
- **PaymentBatch** with unique reference code per submission.
- Admin **generates roster CSV** per sub-group, sends to leader, leader fills `amountPaid` per row, sends back.
- Admin **uploads returned CSV** against the batch. Matches by `participantId` (exact). Each row = an Allocation.
- `paymentState` is **derived**, not stored: PAID / PARTIAL / PENDING / WAIVED.

### Registration gating by reconciliation status (NEW)
- When a registrant selects a sub-group on the public form, the system checks if that sub-group has any `OPEN` batches with non-zero unallocated balance.
- If yes, registration is BLOCKED for that sub-group with a message: "Council X cannot accept new registrations until their last payment batch is reconciled. Contact your council leader."
- Admins can override by reconciling the batch (even with a variance) before the new registration.

### Fees
- Each room type has a `price`.
- Participant has `feeOwed`, locked at room type's price at time of registration / room-type-change.
- Pattern: fee updates only when room type explicitly changes.

### Rooming
- ON-ARRIVAL only.
- Assigning a room implicitly checks the participant in.
- Capacity defined per room, defaults from type.
- Soft overbook on dormitories (allowed with warning). Hard cap elsewhere.
- Gender M or F at room level, follows the registrant. No mixed-gender room type — couple rooms and 24 Houses are modelled as capacity-1 rooms gendered by registrant.
- Rooming blocked unless `paymentState === 'PAID'` or `'WAIVED'`.
- **Override visibility (NEW):** if an admin manually overrides this and rooms a PENDING/PARTIAL participant, the participant detail shows a red "⚠️ Roomed with outstanding balance" banner, and the dashboard surfaces a count of such overrides.

### Form fields
- Required: full name, phone, gender, sub-group, room type.
- Optional but kept: email, date of birth OR age.
- **Cut from v1:** emergency contact name, emergency contact phone.

### Public stats
- Aggregate-only at `/stats/:campId` — totals + per-sub-group counts, no names.

## v1 scope (build this, nothing more)
1. Admin auth (seeded admins)
2. Create/edit a camp
3. Sub-groups for a camp
4. Room types with prices
5. Rooms management (form + CSV bulk import)
6. Public registration with room type preference (sets feeOwed). Blocks if sub-group has unreconciled batches.
7. **Admin-side "Add Participant" form** for late arrivals / desk registration. Mirrors public form but bypasses the registrationOpen and reconciliation-gate checks.
8. Participant list with filters, search, tag management
9. **Payment batches:** create, generate roster CSV, upload allocations CSV, confirm, void allocations
10. Admin actions: assign room (= check in), unassign, undo check-in, cancel, override fee, add/remove tags, change room type
11. Per-camp dashboard: counts per sub-group (registered, paid, partial, roomed) + per room-type × gender breakdown
12. Public aggregate stats page

## Phase 2+ (explicitly OUT of v1)
- Payment aggregators (Paystack, MoMo direct)
- Pre-assigned rooming workflow
- Sub-group leader portal
- Attendee mobile self-service
- Scoped admin roles
- Ministry > Council > Area hierarchy (use Council as flat sub-group for v1)
- Targets tracked in system with progress %
- Facilities ticket / damage report generation on assignment
- Scale-pass optimization (deferred to after Day 4c if needed)
- VIP categories (Bishops, Mothers, sponsored guests)

## Coding conventions
- Small, dumb components. Data fetching at route level.
- Firestore modular SDK directly. No abstraction layer.
- `registrationState` and `checkInState` stored; `paymentState` is DERIVED.
- Flat UPPERCASE state strings matching DATA_MODEL.md exactly.
- All admin writes set `updatedAt` + `updatedBy`. Soft-delete only.
- Denormalize for cheap reads: `subGroupName`, `roomTypeName`, `roomTypePreferenceName`, `roomNumber`.
- Feature folders: `src/features/{feature}/`.
- No state machine library.

## Secrets
- Never hardcode API keys, tokens, or credentials as literal strings in source — including ones that "aren't really secret" (e.g. Firebase Web API keys). Read them from environment variables instead.
  - Client (`src/`): `import.meta.env.VITE_*`, sourced from `.env.local` (gitignored; `.env.example` documents the shape, committed).
  - Functions (`functions/`): `process.env.*`, sourced from `functions/.env` (gitignored; `functions/.env.example` documents the shape, committed).
- If GitHub (or any scanner) flags a committed secret: rotating/revoking the credential in its origin console is the actual fix, not just removing it from the current file — the old value still lives in git history once pushed.
- True secrets (third-party API keys with real access, service account keys) get the same env-var treatment at minimum; for anything Cloud Functions need at runtime, prefer `firebase-functions/params`'s `defineSecret` (Secret Manager) over a plain `.env` value.

## When in doubt
- Cut features rather than add them.
- Choose boring over clever.
- Push back if a feature isn't on the v1 list.
