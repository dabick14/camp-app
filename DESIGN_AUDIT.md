# Design Audit — findings against DESIGN_BRIEF.md

**Method:** Live browser walkthrough (Playwright + Chromium) of the public/unauthenticated
screens (`/login`, `/login/reset`, `/guide`) on both a 390×844 mobile viewport and a
1280×900 desktop viewport, plus a full source-level read of every routed screen and its
child components/modals for the authenticated leader and admin flows.

**Note on method:** the dev server connects Auth and Firestore directly to the live
production project (`camp-app-119bb`); only Cloud Functions has an optional emulator, and
`firebase.ts` explicitly skips App Check initialization in dev ("use the emulator
locally") with no Firestore/Auth emulator actually wired up. Signing in as either the
admin or leader test account failed identically with a Firestore `permission-denied`
error immediately after auth succeeded, before any role-specific code ran — consistent
with App Check enforcement blocking all Firestore reads in dev, not a credential problem.
Retrying login wouldn't fix this, so authenticated screens (roster, dashboard,
reconciliation, rooming, participant list/detail) were audited from source rather than
live pixels. This is worth fixing separately so future audits/testing can drive the real
UI — flagging it here as context, not as a design finding.

---

## Leader-facing

### P0

**1. Screen: every leader screen (Login, Register, Roster, Password reset) — primary buttons and inputs are below mobile tap-target minimums.**
Context: Leader-facing. Violates brief priority #1, "Big tap targets. Fat-fingers-friendly. Nothing small or precise required."
The shadcn `Button` default size is `h-8` (32px) and `Input` is also `h-8` (32px) —
neither is overridden on any leader screen, so "Sign in," "Register," "Send reset link,"
and every text field a leader touches one-handed in a crowd render at roughly 32px,
well under the ~44px iOS/48dp Android recommended minimum. This is a component-level
default, not a one-off, so it affects literally every tap on every leader screen.
Fix: introduce a ≥44px touch-target size (Button and Input) and apply it specifically to the leader-facing route tree.

**2. Screen: Leader payment roster — the claimed-vs-confirmed distinction lives only in a footer caption, not on the control itself.**
Context: Leader-facing. Violates priority #4, "Impossible-to-misread states," and the brief's explicitly named load-bearing item, "the 'mark paid' toggle and its claimed-vs-confirmed distinction."
Each roster row is just a checkmark icon + name + amount; the only place that explains
"this is a claim, not a confirmed payment" is one small `text-xs` sentence at the very
bottom of the page (`src/features/leader-roster/LeaderRosterPage.tsx:209`), disconnected
from the 50+ rows above it.
Fix: add a small inline label (e.g. a "Claimed" chip) next to the checkmark on each row so the distinction travels with the control.

### P1

**3. Screen: Leader register — duplicate-registration decision uses the smallest button size in the app.**
Context: Leader-facing. Violates priority #1, "Big tap targets."
When a soft duplicate is detected, "Register anyway" / "Cancel" render with `size="sm"`
(`h-7`, 28px) — smaller than the rest of the form — at exactly the moment a leader has to
make a real judgment call, one-handed, in a noisy hall (`LeaderRegisterPage.tsx:493-511`).
Fix: bump these two buttons to the default (or larger) size to match the weight of the decision.

**4. Screen: Leader register / roster — top nav tabs are under the tap-target minimum.**
Context: Leader-facing. Violates priority #1.
The Register / Payment roster / Guide tab strip uses `py-1.5` with `text-sm` + a 16px
icon, computing to roughly 32px tall (`LeaderRegisterPage.tsx:333-352`,
`LeaderRosterPage.tsx:130-149|) — this is the nav a leader uses to switch contexts
repeatedly through a registration session.
Fix: increase vertical padding so the tab strip reaches ~44px.

### P2

**5. Screen: Leader guide (`/guide`) — no reading-width constraint on desktop.**
Context: Leader-facing (but reachable from any device). Not a named brief priority, but undercuts "plain language for church volunteers" by making the plain language harder to read.
On a 1280px viewport the guide's body text runs the full width with no `max-w`
container, producing very long line lengths that hurt readability of a document meant to
be read start-to-finish.
Fix: constrain the guide body to ~65-75ch, consistent with the Card-width login/reset screens it links to and from.

**6. Screen: Leader guide (`/guide`) — visual language doesn't match the screens it's linked from.**
Context: Leader-facing. Minor consistency issue against the brief's "commit to a direction" aesthetic goal.
`/login` and `/login/reset` are centered `Card` components; `/guide` is flush-left plain
content with no card/container, styled as if it were a different product.
Fix: wrap the guide in the same container language as the auth screens, or deliberately define a "document" template and reuse it.

**7. Screen: Leader register / roster — success toasts use library defaults, unverified for the one-handed/noisy-hall context.**
Context: Leader-facing. Touches priority #5, "Fast + reassuring... never leave the leader wondering 'did that work?'"
`src/components/ui/sonner.tsx` sets no explicit `position` or `duration`; sonner's default
placement/timing hasn't been confirmed to be legible and reachable on a phone held
one-handed in a crowd. Couldn't verify live (see Method note above).
Fix: explicitly set a mobile-appropriate position (e.g. top-center) and confirm duration via live device testing before relying on it as "reassuring."

---

## Admin-facing

### P0

**8. Screen: Dashboard — the "Overrides" metric has no visual distinction from benign counts.**
Context: Admin-facing. Directly violates the brief's named load-bearing item, "the override banner (`roomedWithoutFullPayment`) — a red flag that must stay a red flag," and priority #2, "trustworthy money display... errors here cost real money."
`DashboardPage.tsx:135` renders `<BigMetric label="Overrides" value={metrics.overrides} />`
in the exact same neutral card styling as "Registered," "Paid," and "Roomed" — no color,
icon, or emphasis even when the count is nonzero. An admin scanning the dashboard has no
visual cue that this number is different in kind from the others.
Fix: give the Overrides tile a destructive/amber treatment (icon + color) whenever count > 0, mirroring the red banner already used correctly in the participant detail drawer.

**9. Screen: every admin tab (persistent header) — the Overrides count is missing from the one surface visible at all times.**
Context: Admin-facing. Same load-bearing item as #8.
`CampLayout.tsx`'s metric strip (visible on Participants, Rooms, Leaders, Payments,
Settings — everywhere except the dedicated Dashboard tab) shows Registered/Paid/Partial/
Pending/Roomed but omits Overrides entirely. An admin who never opens the Dashboard tab
in a session never sees this count.
Fix: add an Overrides figure to the persistent strip, styled to stand out when nonzero.

**10. Screen: Participant list — the override flag is a 14px icon behind a hover-only tooltip.**
Context: Admin-facing. Same named load-bearing item as #8/#9.
`ParticipantListPage.tsx:565-568` shows `roomedWithoutFullPayment` as a small
`AlertTriangle` with a native `title` attribute — invisible until mouse hover, unusable
on touch, easy to miss while scanning a long table — while the same flag correctly gets a
bold full-width red banner in the detail drawer (`DetailDrawer.tsx:393-436`). The flag is
one surface strong, one surface weak.
Fix: add a visible red badge/chip (not just an icon+tooltip) next to the room number in the list row.

### P1

**11. Screen: Batch detail — "Reopen" has no confirmation, unlike every sibling action on the page.**
Context: Admin-facing. Violates priority #3, "Safe destructive actions. Void, reopen, override, room-without-payment all need clear confirmation and visible consequences."
`BatchDetailPage.tsx:364-366` fires `handleReopen` directly on click for a RECONCILED
batch, while Void (with a required reason) and Reconcile-with-variance (with a required
note) both go through a full confirm dialog on the same page.
Fix: add the same Dialog-plus-reason pattern used for Void.

**12. Screen: Batch detail — two parallel reconciliation flows are shown at once.**
Context: Admin-facing. Violates priority #1/#2, "information clarity" and "trustworthy money display... unambiguous."
The page renders the current claimed-participant reconciliation panel *and* a fully
interactive "legacy" CSV-allocation section (own totals, own Upload/Void actions) that the
code itself comments as superseded (`BatchDetailPage.tsx:45, 444-505`). Two competing
mental models of "reconcile" on the one screen where mistakes cost money.
Fix: collapse the legacy Allocations section behind a disclosure, or remove it from the primary path.

**13. Screen: Participant detail drawer — "Undo check-in" has no confirmation, unlike its neighbors.**
Context: Admin-facing. Violates priority #3.
Cancel, Unassign Room, Void, and Clear-override-flag all require an inline confirm step
in this same drawer; "Undo check-in" (`DetailDrawer.tsx:666-676`) fires immediately on
click.
Fix: add the same inline confirm pattern used for Unassign Room.

**14. Screen: Rooms — room deletion uses the browser's native `confirm()`.**
Context: Admin-facing. Consistency/trust issue against the brief's "commit to a direction, not AI-generated generic" aesthetic goal.
`RoomsPage.tsx:81` is the only confirmation in the entire app that isn't the custom
`Dialog` component — every other confirm (Void, Cancel, Unassign, Reconcile-with-variance,
Deactivate leader) uses the app's own styled dialog.
Fix: replace with the same Dialog pattern used everywhere else.

**15. Screen: Camp settings — the "Registration open" toggle has the same visual weight as cosmetic fields.**
Context: Admin-facing. Touches priority #2/#3 — this switch instantly blocks every leader camp-wide, but nothing about its presentation signals that.
In `CampForm.tsx:152-159` the switch sits directly above the Save button, styled
identically to Image URL, Currency, and Description in the same form, with no
differentiated confirmation before "Save changes" commits it.
Fix: visually separate this control (its own bordered/highlighted block) and consider a distinct confirmation given its blast radius.

**16. Screen: Batch detail — disabled-button reasoning is hidden behind a native tooltip.**
Context: Admin-facing. Same pattern as #10 — recurring across the app.
"Reconcile & Confirm" is disabled when totals don't match, with the explanation only in a
`title` attribute (`BatchDetailPage.tsx:355`) — invisible until hover, same failure mode
as the override-flag tooltip.
Fix: show the reason as visible inline text near the disabled button.

### P2

**17. Screen: Camp settings / Rooms import — two different "success" greens.**
Context: Admin-facing. Minor design-system consistency issue.
The established positive-state token is `emerald` (PAID badges, claimed rows, dashboard,
batch status) but `CampSettingsPage.tsx:104` ("Changes saved.") and
`CsvImportModal.tsx:181` ("Valid rows") use plain Tailwind `green` instead.
Fix: standardize on one token app-wide.

**18. Screen: Payments summary / room-assignment buttons — emoji used as status iconography alongside a separate Badge system.**
Context: Admin-facing. Undercuts the brief's "commit to one direction" aesthetic goal — scattered emoji read as unfinished, not designed.
`PaymentsPage.tsx:177,180` ("⚠️ Unreconciled" / "✅ Reconciled") and
`DetailDrawer.tsx:624,702` (⚠️ prefix on Assign/Change Room) use raw emoji characters,
while the rest of the app (participant list, dashboard, batch status) uses colored
`Badge` components for the same kind of state.
Fix: replace emoji with the same Badge/icon components used elsewhere.

---

## Top 5 highest-impact fixes

1. **Raise Button/Input default touch-target size for the leader route tree** (#1) — the single most systemic fix; every tap on every leader screen is affected today.
2. **Make the Overrides count visually loud wherever it appears** (#8, #9) — protects the brief's explicitly named "must stay a red flag" item on both surfaces where it currently reads as a neutral number.
3. **Turn the participant-list override flag into a visible badge, not a hover tooltip** (#10) — the third surface for the same named load-bearing flag, currently the weakest.
4. **Add confirmation to "Reopen batch" and "Undo check-in"** (#11, #13) — closes the gap with every sibling destructive action and directly serves priority #3's explicit requirement.
5. **Surface the claimed-vs-confirmed distinction on the roster row itself, not just in a footer caption** (#2) — protects the other explicitly named load-bearing item ("mark paid" toggle) at the one point of contact leaders actually use.
