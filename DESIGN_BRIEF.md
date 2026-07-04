# Camp App — Design Brief

A brief to guide the UX/UI pass. Every design decision should be measured against
this, not against generic "make it look better." The app has TWO distinct usage
contexts with opposing priorities — do not flatten them into one style.

---

## The product in one line
An internal church camp operations tool: sub-group leaders register their people
and record who paid; admins reconcile payments, assign rooms, and run camp logistics.

## Two contexts, two design languages

### Context A — Leader-facing (register, mark paid)
**Who:** church volunteers, not tech users. **Device:** phones, almost always.
**Situation:** standing in a crowd at a gathering, registering people on the spot,
one hand, possibly poor data, time pressure, distractions.

**Priorities (in order):**
1. **Big tap targets.** Fat-fingers-friendly. Nothing small or precise required.
2. **One obvious primary action per screen.** No hunting for the main button.
3. **Forgiving forms.** Hard to mis-submit; clear which fields are required; mobile
   keyboards behave (no zoom-on-focus, right keyboard per field type).
4. **Impossible-to-misread states.** "Marked paid," "not paid," and the
   "registration paused" state must be instantly legible at a glance — these carry
   real financial meaning (see the confirmed-only model).
5. **Fast + reassuring.** Clear success feedback after every action. Never leave the
   leader wondering "did that work?" in a noisy hall.

**NOT priorities:** density, information richness, "premium" feel, cleverness.

### Context B — Admin-facing (dashboard, reconciliation, rooming)
**Who:** camp admin(s), more comfortable with the tool. **Device:** likely laptop/desktop,
sometimes tablet. **Situation:** seated, careful work, reconciling money, assigning rooms.

**Priorities (in order):**
1. **Information clarity + density.** Show a lot without clutter — tables, counts,
   money totals, status at a glance.
2. **Trustworthy money display.** Amounts, variances, and payment states must be
   unambiguous. Reconciliation match/short/over should be obvious and hard to
   misread — errors here cost real money.
3. **Safe destructive actions.** Void, reopen, override, room-without-payment all need
   clear confirmation and visible consequences (these already have audit flags).
4. **Efficient repeated actions.** Rooming and reconciliation are done many times in a
   session — minimize clicks for the common path.

**NOT priorities:** big playful buttons, hand-holding, mobile-first (mobile is
secondary here, but should still not break).

## Load-bearing UI (do not let a redesign obscure these)
- The **"mark paid" toggle** and its claimed-vs-confirmed distinction.
- The **"registration paused for your group"** state on the leader form.
- The **payment status** display (PENDING/PARTIAL/PAID/WAIVED) wherever it drives rooming.
- The **override banner** (`roomedWithoutFullPayment`) — a red flag that must stay a red flag.
- The **reconciliation match/short/over** comparison on the admin batch screen.

## Voice & copy
- Name things by what the user controls, not how the system works. Leaders "mark paid,"
  they don't "set paymentClaimed."
- Active voice on buttons; the action keeps its name through the flow (button "Mark paid"
  → confirmation "Marked paid").
- Errors and empty states give direction, not mood: what happened, what to do next.
- Plain language for church volunteers — no jargon on the leader side.

## Constraints
- The app is LIVE with real registrations. Design work happens on a branch, reviewed
  and tested per-flow before merging. Do not break working flows.
- 82 tests cover logic (functions, rules) but NOT the UI — so UI changes need manual
  per-flow verification, especially the load-bearing UI above.
- Mobile inputs must keep ≥16px font (prevents iOS zoom-on-focus) — already a convention.
- Don't pull in heavy new dependencies for styling without a clear reason.

## The aesthetic question (for the design lead to answer)
This is a church community tool, not a fintech startup. It should feel: trustworthy,
warm, calm, and clear — not corporate, not flashy, not "AI-generated generic"
(avoid the cream-bg + serif + terracotta default; avoid dark-mode-single-acid-accent;
avoid broadsheet hairline rules). Pick a direction that fits a Ghanaian church camp
community and commit to it. Spend boldness in ONE signature place; keep everything
else quiet and disciplined.
