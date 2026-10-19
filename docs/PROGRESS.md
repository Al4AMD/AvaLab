# PROGRESS.md — AvaLab status log

> Living log. Agents update every session: what changed, what is next, known issues, items needing owner review.

## Wave 0 (M0 Foundation) — **done**, 2026-10-19

13/13 tasks complete. Commit range `c56fbe2..ea68089` (T13) plus follow-up docs fixes and M0 close-out fixes (see git log), on `feat/wave-0-foundation`. Per-task ledger: `.superpowers/sdd/foundation/progress.md` (scratch, not committed).

| Task | Result | Commit(s) |
|---|---|---|
| T1 SDD harness, plans tree, project agents, gitignore | complete | c56fbe2 |
| T2 monorepo scaffolding: pnpm workspaces, Biome, root scripts | complete | f38cc30 |
| T3 golden-vector pipeline (energy fixtures) | complete | 847e4fa |
| T4 `packages/dsp` skeleton: energy, avg power, time helpers, golden loader | complete | 183df21 |
| T5 API skeleton: config, error envelope, health endpoint | complete | 5e4d78b, b8a5aba, 76c282e |
| T6 ffprobe-validated ingest + upload cap + cleanup | complete | 197db46, d53e401 |
| T7 TTL sweeper + delete endpoint | complete | bb87207 |
| T8 audio serving with HTTP Range (D-007 semantics) | complete | 8c068a9, 228ef36, 3e732ec, f865a93 |
| T9 OpenAPI → TS client generation (D-008, D-009) | complete | 412fdc5, 0ca70ac |
| T10 web shell: i18n, RTL, design tokens, health status | complete | 3c20491, ed7545d |
| T11 i18n key checker wired into `pnpm check` | complete | 0c4b612 |
| T12 Docker Compose deployment (api + web/Caddy) | complete | d907e7e |
| T13 docs, demo clips, third-party register, progress | complete | this commit |

Verified at close-out: `pnpm check` green; `uv run --directory apps/api pytest -q` green; `pnpm e2e` 4/4 green; docker compose smoke reproduced by the verifier (host 8080 was occupied by Homebrew Apache during dev, override port used for the local smoke — committed compose keeps `8080:80`).

## What's left

- **Wave 1** — `docs/plans/wave-1/` (4 executable plans: `01-fourier-transforms.md`, `02-signals-and-metrics.md`, `03-systems-and-filters.md`, `04-codecs-and-time.md`). Pure-TS DSP + golden vectors; no UI, no router (see D-015).
- Wave 2+ — not planned yet; see `docs/plans/README.md` for the wave map.

## Known issues / deferred minors (carried out of Wave 0)

From the T1–T12 ledgers; none blocking, each has an upgrade path:

- T2: `biome.json` `$schema` pinned `2.5.15` vs caret devDependency — bump together at final review.
- T3: `tools/golden/tests/test_fixtures.py:22` dead `REPO_ROOT` constant; `energy.json` 1.4 MiB one-float-per-line (compact only if Wave 1 fixtures get heavy).
- T4: `packages/dsp/test/fixtures.ts:33` `JSON.parse` outside try/catch (error lacks path); per-case shape unvalidated before cast (fixtures.ts:42).
- T5: `.env.example` sits at repo root while `Settings` `env_file=".env"` is CWD-relative (`apps/api` CWD) — document or relocate; ambient-env test isolation; no-body statuses (204/304) would get JSON bodies (no such routes today).
- T6: `_parse_int` accepts bools (paranoia only); chunked-upload test delivers a single ASGI message (TestClient joins generator bodies; disclosed).
- T7: `make_client` helper duplicated in `test_ttl.py` vs `test_ingest.py` — hoist to conftest at cleanup.
- T8: multi-range with one non-servable part → whole set 416 (mirrors starlette); `If-Range` ignored by route validation; reverse TOCTOU delete-between-stat-and-send (starlette send phase, inherent).
- T9: `app.openapi()` override short-circuits FastAPI route-version cache (latent; no post-boot route registration today); `openapi_utils` strips paths only (webhooks = future scope).
- T11: checker raw-scan counts `t("k")` inside comments/strings (false-negative-safe); misses `t ("k")`/static backticks (fails loud); CLI symlink realpath edge.
- T12: bare `/api` falls to the SPA (no functional impact; app uses `/api/v1/...`); uv cache persists in the api image layer (size only).

## Needs human Persian review

`apps/web/src/i18n/fa.json` — 8 keys drafted by an agent, natural academic phrasing requested, plus the language toggle control:

- `app.title`, `app.subtitle`, `app.language.switchLabel`
- `app.health.loading`, `app.health.ok`, `app.health.offline`, `app.health.offlineDetail`
- `app.privacy.ttlNotice`

(Future Persian copy: every wave's fa strings land in this section until the owner reviews them.)

## Next recommended step

Start **Wave 1, plan `01-fourier-transforms.md`** via the subagent-driven-development workflow (fresh session, ledger under `.superpowers/sdd/01-fourier-transforms/`). Do not begin later plans while an earlier one has failing checks.

## Session log

### 2026-10-19 — Session 1 (bootstrap)

- Done: `AGENTS.md` written (owner). `LICENSE` = GPL-3.0 (owner). All §16 open questions answered → recorded in `docs/DECISIONS.md` (D-001 … D-006).
- Repo state at the time: git initialized; only `LICENSE` tracked.
- Next step was: write the Wave 0 + Wave 1 task-level plan, then execute M0.

### 2026-10-19 — Wave 0, Task 10 (F17 web shell)

- Done: `apps/web` React shell — Vite + React 19 + Tailwind v4 + i18next; fa default RTL / en LTR toggle (persisted in `localStorage["avalab.language"]`, `<html lang/dir>` synced at boot and on change); design tokens in `src/styles/app.css` `@theme` (dark scientific-instrument theme, single teal accent); `HealthStatus` (typed `GET /health` via openapi-fetch, translated loading/ok/offline states, raw errors never rendered); hand-vendored `ui/button.tsx` + `lib/cn.ts`; self-hosted Vazirmatn v33.003 woff2 (regular/medium/semibold/bold + OFL.txt); TTL privacy notice footer; Playwright chromium smoke (3 specs, API absent by design); `docs/THIRD_PARTY.md` initial table.
- Verified: `pnpm --filter @avalab/web typecheck` ✓ · `pnpm --filter @avalab/web test` 3/3 ✓ · `pnpm e2e` 3/3 ✓ · `pnpm check` ✓ (lint, typecheck, dsp 23 + web 3 tests).
- Notes: Vite 8 `preview` inherits `server.proxy`; the preview proxy is explicitly disabled (`preview.proxy: {}`) so the no-API e2e path gets the SPA fallback (200 HTML) instead of a proxy 502 that would log a browser console error — `HealthStatus` maps any non-`{status:"ok"}` payload to offline.
- Needs owner review: Persian copy of `apps/web/src/i18n/fa.json` (8 keys).

### 2026-10-19 — Wave 0, Task 11 (F17 i18n key checker)

- Done: `scripts/i18n-check.mjs` — dependency-free checker with `checkI18n({root, localesDir, sourcesGlob, dynamicAllowlistPath})`: locale parity (`fa`↔`en`, nested keys flattened to dot paths), literal `t("key")`/`t('key')` scan over `apps/web/src/**/*.{ts,tsx}`, unused-key check with segment-aware dynamic allowlist; returns `{file, key, reason}` findings; CLI exits 1 on findings / 0 clean / 2 on crash. `scripts/i18n-dynamic-keys.json` lists the 3 `app.health.*` keys reached via `t(labelKey)` in `HealthStatus.tsx`. `scripts/i18n-check.test.mjs` — 13 node:test cases. Root `package.json`: `check` ends with `&& pnpm i18n:check`; `test` ends with `&& node --test "scripts/**/*.test.mjs"`.
- Verified: `node --test` 13/13 ✓ · `pnpm i18n:check` → `i18n-check: OK` exit 0 ✓ · failing temp fixture → 1 finding, exit 1 ✓ · malformed locale → exit 2 ✓ · `pnpm check` exit 0 (biome 36 files, dsp 23 + web 3 + scripts 13 tests).
- Notes: `node --test scripts/` (directory form) is broken on Node 21+ (nodejs/node#64555); wired with an explicit `scripts/**/*.test.mjs` glob instead.

### 2026-10-19 — Wave 0, Tasks 12–13 (docker, docs, demo clips, close-out)

- T12: `compose.yaml` + `docker/api.Dockerfile` + `docker/web.Dockerfile` (node build → Caddy serving static + `/api` proxy); API healthcheck exercises the real ingest path; storage volume `/data` chowned to uid 10001. Smoke reproduced with a host-port override (8080 occupied locally by Homebrew Apache).
- T13: `tools/demo_clips` generator (numpy only, fixed seeds; three 5 s 48 kHz mono clips) with clips committed under `apps/web/public/demo/` (CC0, D-016); `README.md` quickstart with the real scripts; `docs/THIRD_PARTY.md` completed (full lockfile tables, Caddy, audio assets); `docs/DECISIONS.md` D-010…D-016; `docs/plans/README.md` wave-0 → done.
- Verified this session: generator run twice → byte-identical SHA-256 for all three WAVs; `ffprobe` → 48000 Hz, mono, 5.0 s; `pnpm check` ✓; `uv run --directory apps/api pytest -q` ✓.
