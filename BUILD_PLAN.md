# Build Plan — Fresh Repo, ~7 Days

Fresh repo. The old code's good parts (shadcn setup, tailwind config, maybe login form structure) can be copied over by hand if useful, but the data model and auth are starting from scratch.

Each day has a "done when" checkpoint. When it passes, stop and move on — even if it's ugly.

## Day 0 — Setup (~3 hours)
- Create NEW Firebase project (don't reuse the old one — clean slate)
- Enable Firestore, Auth (email/password), Hosting, App Check (dry-run mode)
- Scaffold fresh Vite + React + TS app
- Install: `firebase`, `react-router-dom`, `tailwindcss`, shadcn/ui init
- Set up `src/lib/firebase.ts` with env-var-based config + App Check init
- Manually create 2-3 admin users in Firebase Auth console
- Manually add `/admins/{uid}` docs for each via console
- Set up basic routing skeleton: `/login`, `/admin`, `/r/:campId`
- Implement `ProtectedRoute` that checks `/admins/{uid}` exists in Firestore (not just auth status)

**Done when:** any seeded admin can log in and see an empty admin shell. Non-admins are kicked to login.

## Day 1 — Camps + Sub-groups
- `/admin/camps` — list cards of all camps
- `/admin/camps/new` — create form (name, location, dates, description, image URL, min/max age, max participants, registrationOpen toggle)
- `/admin/camps/:id` — camp landing (placeholder dashboard for now)
- `/admin/camps/:id/settings` — edit camp + sub-groups in one page
  - Sub-groups section: add, rename, reorder (drag or up/down arrows), set `order`
  - No delete UI — admins can rename if a sub-group is wrong

**Done when:** you can create a camp, define 3-4 sub-groups, toggle registrationOpen.

## Day 2 — Room Types + Rooms
- In camp settings, add a Room Types section
  - Add type (name, defaultCapacity, allowOverbook toggle, order)
  - Edit / reorder
- `/admin/camps/:id/rooms` — rooms management page
  - Table of all rooms (number, type, gender, capacity, occupancy)
  - "Add Room" button (form: number, type, gender, capacity override)
  - "Import CSV" button (parses `number, type, gender, capacity, notes`, validates types/genders, shows preview, confirms)
  - Edit / delete (delete blocked if `currentOccupancy > 0`)

**Done when:** you can define types, bulk-import a 50-room CSV, see them in the list with correct occupancy = 0.

## Day 3 — Public registration
- Route: `/r/:campId` — public form, no auth
- Fetches camp + sub-groups (publicly readable per rules)
- Renders only if `registrationOpen === true`
- Fields: full name, phone, email (optional), gender, DOB or age, emergency contact, sub-group picker
- On submit: write participant doc with initial flat states + empty `tags: []` + no roomId
- `/r/:campId/done` — confirmation page with their sub-group echoed back
- Mobile-friendly layout (this is the only page registrants see)

**Done when:** you can fill out the form on a phone end-to-end and see your participant in the admin participant list.

## Day 4 — Participant list + Desk Actions
This is the heaviest day. Pace yourself.

- `/admin/camps/:id/participants` — main table
  - Columns: name, phone, gender, sub-group, payment, check-in, room, tags
  - Filters: sub-group, payment state, check-in state, tag (multi-select)
  - Search: name OR phone (client-side fine for <500 people)
  - Row click opens detail drawer
- Detail drawer / modal:
  - All participant info
  - Actions: Mark Paid, Assign Room, Mark Unpaid, Unassign Room, Undo Check-In, Cancel, Add/Remove Tags
  - Audit fields shown (who, when) for each state
- Implement Assign Room flow per ROOMING_SPEC.md
  - Room picker filtered by gender, grouped by type
  - Soft-overbook confirm dialog
  - Transactional write: updates participant + room.currentOccupancy

**Done when:** you can process a fake camp of 20 people from arrival → paid → roomed in under 5 minutes total.

## Day 5 — Dashboard + Tags + CSV Export
- `/admin/camps/:id` — dashboard
  - Top cards: total registered, total paid, total checked in (excluding cancelled)
  - Per-sub-group table: name | registered | paid | roomed
  - Refresh on focus, no realtime sockets
- Tag management on participant detail (simple add/remove)
- CSV export button on participant list — respects current filters
- Format per DATA_MODEL.md (`tags` semicolon-separated)

**Done when:** dashboard answers "how many from Choir are checked in?" at a glance, and CSV export gives admins a usable spreadsheet.

## Day 6 — Polish + Deploy
- Flip App Check to enforce
- Final security rules pass — test denied paths in rules playground
- Loading states, empty states, error toasts on every page
- Test public registration end-to-end on a deployed URL
- Deploy to Firebase Hosting
- Smoke test all flows on the live URL

**Done when:** a stranger could register at the public URL and you could process them through to a room.

## Day 7 — Dogfood Buffer
- Seed a fake camp with 50-100 participants and 50 rooms
- Time yourself doing 10 desk assignments
- Fix the worst friction points
- Write a 1-page admin cheat sheet for camp-day operators
- Show it to one trusted person, take notes, fix what's confusing

**Done when:** you'd be comfortable running a real camp with it tomorrow.

## Cut list (in this order, if running out of time)
1. Cancel action — admins can ignore cancelled people, console as backup
2. Undo check-in — Firestore console as escape hatch
3. Drag-to-reorder sub-groups / room types — just create in desired order
4. Tag multi-select filter — single-tag filter only
5. Search bar — filters alone cover most cases at <300 people
6. Per-sub-group dashboard table — just show totals

## What to NOT cut
- App Check enforcement (security)
- Transactional room assignment (data integrity)
- Public registration mobile responsiveness (this is the user-facing surface)
- Audit fields on payment / room / check-in (you'll need them for disputes)
