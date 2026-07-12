# Camp App — Design Spec (Aesthetic Pass)

Concrete token system for the visual polish pass. Every colour, type, and layout
decision derives from this. The goal: a calm, trustworthy, warm church operations
tool — NOT a fintech startup, NOT a spreadsheet. Boldness is spent in ONE place
(the identity header); everything else is quiet and disciplined.

Reference feel: LoadSwift-style operations tool (colour as accent, not flood;
dense where useful; clean). NOT the acid-green consumer look.

---

## THE MOST IMPORTANT RULE: two reds, different jobs

The church brand colour is red. Red also already means "danger" in the app.
These MUST stay visibly distinct and never swap roles:

- **Brand Red `#A63446`** (deep warm rose/brick red) — IDENTITY only: primary
  buttons, active nav/tab state, the signature header accent, key highlights,
  links. Confident, warm, trustworthy — never used for warnings.
- **Alert Red `#DC2626`** (brighter, hotter) — DANGER only: errors, delete
  actions, the `roomedWithoutFullPayment` override flag, destructive confirms.
  Reserved strictly for "something is wrong."

A brand-red primary button must never read as a warning; an alert-red error must
never read as branding. If in doubt, brand = deeper/warmer, alert = brighter/hotter.

---

## Colour tokens

- **Ink** `#1F1B1B` — primary text, dark UI (slightly warm near-black)
- **Paper** `#FBF9F7` — app background (soft warm off-white — NOT stark white;
  stark white is what makes it feel like a spreadsheet)
- **Surface** `#FFFFFF` — cards/panels sit ON the paper bg so they lift off it.
  This card-vs-background contrast is a big part of looking "designed."
- **Brand Red** `#A63446` — the single brand accent (see rule above)
- **Brand Red hover/pressed** `#8E2C3B` (darker) / tint `#F5E6E8` (light bg for
  active/selected states, subtle red wash)
- **Alert Red** `#DC2626` — danger only
- **Border** `#EAE5E1` — warm light hairlines/dividers (softer than cold grey)
- **Muted text** `#6B6560` — secondary text, labels, captions

### Status colours (semantic — keep meaningful, harmonize don't clash)
- PAID → green (keep existing emerald family, e.g. `#1E7A54` text / `#E7F3EC` bg)
- PARTIAL → amber (`#B7791F` text / `#FBF0DD` bg)
- PENDING → muted amber-RED, NOT brand red and NOT alert red — reads "waiting,"
  e.g. `#B54A3A` text / `#FBEAE5` bg. Must be distinguishable from Brand Red.
- WAIVED → neutral grey badge
- Reconciled ✓ green / Unreconciled ⚠ amber (keep, harmonize to the above)

---

## Typography

- **Display (headings only, used with restraint):** Fraunces (or Bricolage
  Grotesque) — for the camp name, page titles ("Camp settings", "Payments"),
  section headers. Gives warmth + identity. Do NOT use it for body, labels, or
  data — restraint is what makes it feel intentional.
- **Body / UI:** Inter — all tables, forms, labels, buttons, body text. Clean,
  neutral, great for dense data.
- **Numbers / data:** Inter with **tabular figures** (`font-variant-numeric:
  tabular-nums`) for the metric strip, money columns, any aligned numbers.
- Type scale: set a clear scale (e.g. 12/14/16/20/28/36) with intentional
  weights. Headings in Fraunces at the larger sizes; everything else Inter.
- Sentence case for UI copy (not Title Case, not ALL CAPS except tiny eyebrow
  labels like "REGISTERED" which can stay uppercase small-caps style).

---

## Signature element: the identity header

The one bold, memorable thing. Everything else stays quiet.
- The camp name ("Harvest Camp 2026") in the **display font**, confident size.
- The metric strip below it: tabular figures, generous spacing, **Brand Red as
  the accent** on the key/active numbers. Clear separation between each metric's
  number and its label (they currently collide on mobile — fix).
- Consider a distinct **money card** in this header: confirmed collected vs
  outstanding (CONFIRMED money only — reconciled, not claimed — consistent with
  the confirmed-only model). Visually differentiate money from people-counts so
  they're never misread as the same kind of number.
- This header is the signature: it's seen first on every screen AND it's the
  data the user checks constantly. Boldness spent where it's both seen and useful.

---

## Layout & components (quiet, disciplined, consistent)

- Use the shared page-content container established in the layout-consistency
  pass — every tab at identical width/alignment. Do not reintroduce per-page widths.
- **Cards:** white Surface on Paper bg, consistent radius (12px), subtle shadow
  or hairline border (not both heavy). Consistent internal padding.
- **Spacing:** one spacing scale (4/8/12/16/24/32). Generous, consistent.
- **Buttons:** primary = Brand Red, white text. Secondary = white/surface with
  border. Destructive = Alert Red. Consistent height + radius across the app.
- **Tables:** clean, roomy rows, hairline Border dividers, muted-text headers,
  tabular figures for numeric columns. Dense but breathable.
- **Badges/pills:** the status colours above, consistent shape/size everywhere
  (replace any remaining raw emoji status indicators with these badges).
- **Active nav/tab:** Brand Red underline/indicator + Ink text; inactive = muted.

## Quality floor (non-negotiable)
- Responsive to mobile (many users on phones) — every screen works at 390px.
- Visible keyboard focus states.
- Respect reduced-motion.
- Consistent everywhere: the app should feel like one product, not many screens.

## What to AVOID (AI-design tells)
- Stark pure-white backgrounds everywhere (use warm Paper).
- Acid green / neon anything.
- Cream-bg + serif + terracotta (the Claude-default look).
- Colour flooding — brand red is an ACCENT, most of the app is Ink/Paper/Surface/Border.
- Two competing greens or two reds doing the same job (see the two-reds rule).
