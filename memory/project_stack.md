---
name: project-stack
description: Camp app tech stack decisions and scaffolding notes — Vite, Firebase, shadcn/ui setup details
metadata:
  type: project
---

Church camp operations app. See CLAUDE.md, DATA_MODEL.md, ROOMING_SPEC.md, BUILD_PLAN.md in repo root for full spec.

**Day 0 completed.** Shell is scaffolded and building clean.

**Stack:**
- Vite 8 + React + TypeScript (react-tsx template)
- Firebase SDK (firebase@latest) — Firestore, Auth, App Check
- React Router v7
- Tailwind CSS v4 + `@tailwindcss/vite` plugin (NO tailwind.config.js — CSS-first)
- shadcn/ui via `shadcn@4` CLI — radix-nova preset (Geist font, oklch color vars)

**Key config gotchas:**
- shadcn CLI (`shadcn@4`) requires Tailwind v4. v3 breaks on `@theme inline` in `shadcn/tailwind.css`.
- shadcn resolves `@/` alias from root `tsconfig.json` (not tsconfig.app.json). Alias MUST be in root tsconfig.json compilerOptions.paths or CLI writes to a literal `@/` directory.
- `tailwind.config.js` field in components.json is set to `""` (no v4 config file).
- `ignoreDeprecations: "6.0"` needed in tsconfig.app.json for baseUrl.
- shadcn init: use `printf 'y\n' | npx shadcn@latest init -y -b radix -p nova --force` (auto-detects Vite; do NOT pass `-t vite`).

**App Check:**
- Dev: sets `self.FIREBASE_APPCHECK_DEBUG_TOKEN = VITE_APPCHECK_DEBUG_TOKEN ?? true` before initializeAppCheck.
- First dev run prints a debug token to console — add it to Firebase console → App Check → Manage debug tokens.
- Enforcement OFF until Day 6.

**Why:** [[project-day0-done]]
