# Camp App — Project Context

## What this is
An internal operations app for running church camps. Reduces chaos around registration, manual payment tracking, on-arrival room assignment, and check-in.

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

## Users (v1)
- **Admin** — full authority. Multiple admins, all equal. Identified by presence in `/admins/{uid}` collection. Seeded manually in Firebase console.
- **Registrant** — fills public registration form. No account, no login.

No tiered roles. No attendee self-service.

## Core concepts
- **Camp** — top-level container. Everything is scoped to a camp.
- **SubGroup** — admin-defined groups within a camp (e.g. "Youth Council", "Choir"). Registrants pick exactly ONE on signup. Drives all dashboard reporting.
- **Tag** — free-form labels admins add to participants AFTER registration. Used for filtering and CSV export. Do not affect rooming or state machines.
- **Participant** — a registrant within a camp. Holds payment state, check-in state, room assignment, sub-group, and tags.
- **RoomType** — admin-defined per camp (e.g. "Dormitory", "Standard", "Premium"). Has a default capacity and an overbook policy.
- **Room** — a specific room within a camp. Has a number, type, gender (M/F), and capacity (overrides type default if set).

## Locked decisions
- **Auth:** Firebase Auth email/password. No custom JWT layer.
- **Admins:** flat — presence in `/admins` means full access. Seeded via console.
- **Sub-groups:** one required per participant. Created during camp setup.
- **Tags:** free-form strings, multiple per participant. Added by admins post-registration.
- **Payments:** manual only in v1. Admin marks participant as paid.
- **Rooming:** ON-ARRIVAL only. Admin assigns at the desk. Assigning a room implicitly checks the participant in.
- **Room capacity:** defined on each room individually, defaulting from room type.
- **Soft overbook:** allowed on room types where `allowOverbook = true` (e.g. dormitories). Warns but does not block. Hard cap on all others.
- **Gender:** male/female only at room level. No mixed/family rooms in v1.
- **Sub-group + rooming:** sub-group is visible on the rooming screen for awareness, but does NOT enforce room grouping. Admins block off rooms manually.

## v1 scope (build this, nothing more)
1. Admin auth (Firebase Auth, seeded admins)
2. Create/edit a camp (name, location, dates, description, image URL, age range, max participants, registrationOpen toggle)
3. Create/edit sub-groups for a camp
4. Create/edit room types for a camp (name, default capacity, overbook policy)
5. Bulk-import rooms via CSV (number, type, gender, capacity) AND ad-hoc room creation at the desk
6. Public registration form per camp (name, phone, email, emergency contact, gender, DOB or age, sub-group pick)
7. Participant list with filters (sub-group, payment, check-in, tag) and search
8. Admin actions: Mark Paid, Assign Room (= Check In), Undo each, Add/Remove Tags, Cancel
9. Desk flow: search → see status → mark paid if needed → assign room → done in <30s
10. Dashboard per camp: counts per sub-group (registered, paid, roomed)
11. CSV export of participant list (with all tags) for offline analysis

## Phase 2 (explicitly OUT of v1)
- Payment aggregators (Paystack, MoMo, card)
- Pre-assigned rooming workflow
- Bulk / partial payments
- Attendee mobile self-service
- Scoped admin roles (treasurer, organizer, staff)
- Cloning previous camps
- Multi-language
- Reports beyond CSV export
- "Check out" state

## Coding conventions
- Keep components small and dumb. Data fetching at route level.
- Use Firestore modular SDK directly. No abstraction layer (no `firestore.ts` god module).
- One state field per participant per concern: `registrationState`, `paymentState`, `checkInState`. Do NOT collapse into a single `status` field or nest under `states.*`.
- State values are FLAT UPPERCASE strings matching DATA_MODEL.md exactly.
- All admin actions write `updatedAt` + `updatedBy`. Never destroy data; mark as cancelled instead.
- Denormalize names for cheap reads: `subGroupName` on participant, `roomTypeName` on room, `roomNumber` on participant.
- File organization: `src/features/{feature}/` with components, hooks, and services co-located.
- No state machine library. Plain string fields and explicit transition functions.

## When in doubt
- Cut features rather than add them. Deadline is tight.
- Choose boring over clever. This needs to work, not impress.
- If a feature isn't on the v1 list, push back before building.
