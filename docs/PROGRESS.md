# PROGRESS.md — AvaLab status log

> Living log. Agents update every session: what changed, what is next, known issues, items needing owner review.

## 2026-10-19 — Session 1 (bootstrap)

- Done: `AGENTS.md` written (owner). `LICENSE` = GPL-3.0 (owner). All §16 open questions answered → recorded in `docs/DECISIONS.md` (D-001 … D-006).
- Repo state: git initialized; only `LICENSE` is tracked. `AGENTS.md`, `docs/`, `opencode.json`, `.gitignore` are untracked/ignored, not yet committed.
- Not started: M0 — monorepo layout, pnpm workspaces, CI scripts, i18n/RTL shell, `packages/dsp` skeleton, `apps/api` skeleton + ingest, `tools/golden` pipeline, docker compose.
- Next step: write the Wave 0 + Wave 1 task-level plan, then execute M0.
- Needs owner review: none yet (no Persian content written yet).

## 2026-10-19 — Wave 0, Task 10 (F17 web shell)

- Done: `apps/web` React shell — Vite + React 19 + Tailwind v4 + i18next; fa default RTL / en LTR toggle (persisted in `localStorage["avalab.language"]`, `<html lang/dir>` synced at boot and on change); design tokens in `src/styles/app.css` `@theme` (dark scientific-instrument theme, single teal accent); `HealthStatus` (typed `GET /health` via openapi-fetch, translated loading/ok/offline states, raw errors never rendered); hand-vendored `ui/button.tsx` + `lib/cn.ts`; self-hosted Vazirmatn v33.003 woff2 (regular/medium/semibold/bold + OFL.txt); TTL privacy notice footer; Playwright chromium smoke (3 specs, API absent by design); `docs/THIRD_PARTY.md` initial table.
- Verified: `pnpm --filter @avalab/web typecheck` ✓ · `pnpm --filter @avalab/web test` 3/3 ✓ · `pnpm e2e` 3/3 ✓ · `pnpm check` ✓ (lint, typecheck, dsp 23 + web 3 tests).
- Notes: Vite 8 `preview` inherits `server.proxy`; the preview proxy is explicitly disabled (`preview.proxy: {}`) so the no-API e2e path gets the SPA fallback (200 HTML) instead of a proxy 502 that would log a browser console error — `HealthStatus` maps any non-`{status:"ok"}` payload to offline.
- Needs owner review: Persian copy of `apps/web/src/i18n/fa.json` (8 keys) — natural academic phrasing requested.
- Next: Task 11 (i18n key checker), then the remaining Wave 0 tasks.
