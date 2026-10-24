# DECISIONS.md — ADR log

> Every deviation from AGENTS.md and every owner decision from AGENTS.md §16 is recorded here.
> Format: ID, date, status, context, decision, consequences.

## D-001 — Open-source license: GPL-3.0

- Date: 2026-10-19
- Status: accepted (owner — `LICENSE` file exists in repo root)
- Context: AGENTS.md §16 Q0.
- Decision: **GPL-3.0**.
- Consequences: Copyleft. All bundled dependencies must be GPLv3-compatible (MIT/Apache-2.0/BSD are compatible; each recorded in `docs/THIRD_PARTY.md`). Do NOT bundle CC-BY-NC or other non-commercial model weights — they conflict with GPLv3's commercial-use freedom. ffmpeg stays a separate process, never linked (AGENTS.md §14).

## D-002 — Compute device policy: CPU floor, GPU optional

- Date: 2026-10-19
- Status: accepted (owner)
- Context: AGENTS.md §16 Q1. Owner's laptop has both GPU and CPU. Final hosting unknown (university).
- Decision: ML code is device-agnostic (`torch.device` autodetect). Everything MUST run CPU-only — that is the mandatory floor. GPU is an optional accelerator: docker compose gets an optional GPU profile; model selection must never require GPU.
- Consequences: Job ETA estimates must handle both devices. CI runs CPU-only.

## D-003 — Project deliverables: PDF report + slides

- Date: 2026-10-19
- Status: accepted (owner)
- Context: AGENTS.md §16 Q2.
- Decision: Final project deliverables to the instructor are a **PDF report** and **presentation slides**. In-app export (F16) remains the PDF/HTML lab report for students — separate concern.
- Consequences: M5 (Wave 6) includes report + slides production tasks. `docs/PROGRESS.md` and `docs/DECISIONS.md` double as report source material; keep them precise.

## D-004 — Guided experiments: comprehensive coverage

- Date: 2026-10-19
- Status: accepted (owner — "everything professional")
- Context: AGENTS.md §16 Q3.
- Decision: Every P0/P1 tool ships 5–8 guided experiments with expected observations. Agents draft fa+en; owner reviews Persian.
- Consequences: F16 content is a continuous track, not a single task. Persian drafts flagged in `docs/PROGRESS.md`.

## D-005 — Perceptual metric: deferred; fallback chosen

- Date: 2026-10-19
- Status: accepted (agent decision, delegated by owner — "if necessary")
- Context: AGENTS.md §16 Q4.
- Decision: Not needed for MVP. The rate–distortion plot uses already-implemented SNR/MSE. If a perceptual axis is later wanted: single candidate **`pystoi` (MIT, pure Python, speech-only)**. Do NOT add PESQ (ITU reference implementation license is restrictive).
- Consequences: F05 perceptual item stays optional (P2). Revisit in M5.

## D-006 — WebAssembly DSP: benchmark-gated

- Date: 2026-10-19
- Status: accepted (owner — "if necessary")
- Context: AGENTS.md §16 Q5.
- Decision: Keep the escape hatch only. Optimize TypeScript first (typed arrays, precomputed twiddles, in-place). WASM is added ONLY after a recorded benchmark shows the §9 budgets are missed.
- Consequences: No WASM in Wave 1. Benchmarks run when a budget fails or during M5.

## D-007 — Range serving semantics deviate from the Task 8 brief wording

- Date: 2026-10-19
- Status: accepted (agent, empirically verified against installed starlette 1.9.0; revised in Task 8 fix rounds 1–3)
- Context: Task 8 brief expected malformed ranges (`bytes=50-10`, `bytes=abc`) → 416 `range_not_satisfiable`, and multi-range → "first range only". Empirical testing of `FileResponse` showed: malformed/inverted → plain-text 400 raised inside the send phase (bypasses FastAPI exception handlers); multi-range → RFC 9110 `multipart/byteranges` (206, all ranges); unsatisfiable → correct 416 + `Content-Range: bytes */<size>` but as a bare text response with no API error envelope.
- Decision: the route pre-validates every Range header; all rejections are API envelopes. Accepted grammar: a single `bytes=(\d*)-(\d*)` spec with at least one non-empty group, or a comma-joined list of such specs (no whitespace inside the list). Malformed headers (`bytes=abc`, `bytes=`, trailing/empty comma parts, spaced multi-ranges, `bytes=0-9,abc`, wrong unit) → **400 envelope `invalid_request`** (was starlette's plain-text 400). OWS around the commas of a multi-range header (e.g. `bytes=0-9, 20-29`) is likewise rejected 400: RFC 9110 tolerates the optional whitespace, this route intentionally does not (documented strictness). Any spec with a digit run longer than 18 characters → **400 envelope `invalid_request`**, checked before every `int()`; this keeps CPython's 4300-digit conversion limit unreachable from both the route (uncaught `ValueError` → 500) and starlette's parser (`ValueError`-skipped parts → empty ranges → plain-text 400). Inverted single ranges (`end < start`, checked before `start >= size` so the answer is file-size independent) → **416 envelope `range_not_satisfiable`** + `Content-Range: bytes */<size>` (was starlette's plain-text 400). Grammar-valid sets with any non-servable part (start >= size, zero-valued suffix — compared numerically so any zero-padding matches, any range on a zero-byte file) → 416 envelope + header; more than `FileResponse.max_ranges` parts → 400 envelope. Valid single ranges → 206; valid multi-ranges → RFC 9110 `multipart/byteranges` (not "first range only") — both delegated to `FileResponse`.
- Consequences: `GET /audio/{id}` error bodies are always envelopes; no plain-text error path remains for this endpoint (grammar, digit-length cap, unsatisfiable parts and excessive part counts are all rejected route-side before starlette; re-verified in fix round 3 across suffix forms with zero-padding, single ranges, multi-ranges and the digit-cap boundaries). `stat()` failures of any kind (`OSError`) answer the 404 envelope. Tests pin the grammar, statuses and headers so a starlette upgrade cannot silently change semantics.

## D-008 — One shared OpenAPI prefix strip: served spec == exported spec

- Date: 2026-10-19
- Status: accepted (agent, Task 9 fix round 1)
- Context: The app declares `servers: [{"url": "/api/v1"}]` but FastAPI served `/openapi.json` with fully prefixed path keys (`/api/v1/health`). Servers-aware consumers (e.g. Swagger UI "Try it out") combined them into `/api/v1/api/v1/health` → 404, and the served spec diverged from the committed `apps/api/openapi.json`, which the exporter stripped.
- Decision: A single shared helper `avalab_api.openapi_utils.server_relative_schema()` rewrites path keys relative to the server URL. Both `create_app()` (via an `app.openapi()` override) and `export_openapi.py` apply it, so served spec equals the committed artifact by construction. The strip is guarded: `path == "/api/v1"` becomes `/`, only `path.startswith("/api/v1/")` is stripped, anything else (e.g. a future `/api/v12/foo`) is left untouched — never a bare `str.removeprefix`. The TypeScript client base URL default stays `/api/v1`.
- Consequences: Any consumer that ignores `servers` must prepend `/api/v1`; `apps/web/src/api/client.ts` does this via its default base URL. An API test pins served path keys == exporter keys, `/health` present, `/api/v1/health` absent.

## D-009 — Two TypeScript majors (web ^5.9, dsp ^7.0.2) for Wave 1

- Date: 2026-10-19
- Status: accepted (agent, Task 9 report concern)
- Context: `apps/web` needs `typescript@^5.9` because `openapi-typescript@7.13.0` requires the JavaScript compiler API (`ts.factory`), which the TS 7 native compiler does not expose. `packages/dsp` is on `typescript@^7.0.2`. pnpm resolves per-package, so both lines coexist today.
- Decision: Keep the split for Wave 1: web pins TS ^5.9, dsp stays on ^7.0.2.
- Mitigation: keep `packages/dsp` syntax TS 5.9-compatible until the web app imports dsp source; if web starts importing dsp source before the exit condition, add a web-side dsp-import typecheck smoke.
- Exit condition: `openapi-typescript` gains TS 7 support, or the owner decides a single TS line.

## D-010 — Biome (lint + format) instead of ESLint + Prettier

- Date: 2026-10-19
- Status: accepted (agent, Wave 0 Task 2)
- Context: AGENTS.md §3 offers ESLint + Prettier or Biome but demands picking one at M0 and never mixing.
- Decision: **Biome** (`@biomejs/biome` 2.5.15) is the single JS/TS linter + formatter; `pnpm lint` = `biome check .`, `pnpm format` = `biome format --write .`.
- Consequences: One config (`biome.json`), one binary, no plugin ecosystem; if a rule Biome cannot express is ever required, record it here and ask the owner before adding a second tool.

## D-011 — OpenAPI client: `openapi-typescript` (types) + `openapi-fetch` (runtime)

- Date: 2026-10-19
- Status: accepted (agent, Wave 0 Task 9)
- Context: AGENTS.md §3 requires the TypeScript API client to be generated from OpenAPI, never hand-written.
- Decision: `scripts/gen-api.mjs` runs `openapi-typescript` over `apps/api/openapi.json` → `apps/web/src/api/schema.d.ts`; runtime calls use `openapi-fetch` with base URL default `/api/v1` (spec `servers` are stripped relative, see D-008).
- Consequences: Both packages are MIT (GPL-3.0-compatible). `openapi-typescript` requires the TS JavaScript compiler API, which forced the two-TS-majors split (D-009).

## D-012 — Caddy for the web container (static files + `/api` reverse proxy)

- Date: 2026-10-19
- Status: accepted (agent, Wave 0 Task 12)
- Context: AGENTS.md §3 says "static build behind nginx/caddy" for deployment.
- Decision: **Caddy** (`caddy:2-alpine`, Apache-2.0) serves `apps/web/dist` and proxies `/api/*` to the `api` service, path-preserving, so no CORS in the deployed stack.
- Consequences: One container, one config (`docker/Caddyfile`); host port 8080 by default. nginx is not used anywhere. TLS termination is out of scope until the hosting target is decided (AGENTS.md §16 Q1): the compose stack serves plain HTTP, and the eventual host/reverse proxy terminates TLS.

## D-013 — Persian font: self-hosted Vazirmatn v33.003 (OFL-1.1)

- Date: 2026-10-19
- Status: accepted (agent, Wave 0 Task 10)
- Context: AGENTS.md §6 requires a Persian-capable, open-license font, self-hosted, not from a CDN.
- Decision: **Vazirmatn v33.003** woff2 (regular 400 / medium 500 / semibold 600 / bold 700) vendored under `apps/web/public/fonts/` with its `OFL.txt`. OFL-1.1 is GPL-3.0-compatible for bundling (font files are not relicensed).
- Consequences: No runtime font fetch; provenance recorded in `docs/THIRD_PARTY.md`.

## D-014 — Project SDD agents committed under `.opencode/agents/`

- Date: 2026-10-19
- Status: accepted (controller, Wave 0 Task 1; fallback exercised per ledger R3)
- Context: The subagent-driven-development workflow needs `implementer` / `verifier` / `debugger` agents; the briefs are project artifacts meant to be public with the repo.
- Decision: The three agent definitions live in `.opencode/agents/` and are committed. In the Wave 0 session they were not hot-loaded, so dispatches used the built-in `general` subagent with the same briefs as fallback (no material cost).
- Consequences: Future opencode sessions load the project agents; edits to them are normal reviewed commits.

## D-015 — React Router deferred to Wave 2

- Date: 2026-10-19
- Status: accepted (agent, Wave 0 Task 10)
- Context: AGENTS.md §3 lists React Router; AGENTS.md Wave 0 "out of scope" excludes routes.
- Decision: The Wave 0 shell is a single view without a router; routing (and URL-serialized tool state, §10) arrives with the first tool views in Wave 2.
- Consequences: No router dependency in `package.json` yet; adding it is a Wave 2 decision with the URL-state design.

## D-016 — Bundled demo audio: self-generated, CC0 dedication

- Date: 2026-10-19
- Status: accepted (agent, Wave 0 Task 13)
- Context: AGENTS.md F01 requires bundled demo clips; AGENTS.md §14 forbids copyrighted music and requires recorded provenance.
- Decision: The three demo clips (`apps/web/public/demo/*.wav`) are generated by `tools/demo_clips/generate.py` (fixed seeds/params, byte-reproducible) and dedicated to the public domain under **CC0-1.0 by the project** as part of the GPL-3.0 repository — no third-party audio is committed.
- Consequences: Regeneration is a one-liner; determinism is verified by double-run hash comparison; provenance noted in `docs/THIRD_PARTY.md`.

## D-017 — Filter design and analysis rulings (Wave 1 Plan 03)

- Date: 2026-10-24
- Status: accepted (controller)
- Context: Wave 1 Plan 03 realizes IIR filters as a single b/a pair, where double-precision roots at realized order 16 are ill-conditioned; repeated zeros at z = −1 make root-to-root golden comparison unreliable; and group delay needs a formula the golden generator can reproduce exactly.
- Decision:
  - Even-tap FIR highpass/bandstop designs throw `RangeError`, mirroring SciPy `firwin`'s Type II restriction.
  - Group delay is the central finite difference of the unwrapped `freqz` phase on the inclusive grid (one-sided at the endpoints); the golden generator applies the identical formula.
  - b/a IIR designs must pass the solver envelope `max|p| ≤ 0.995` and a 48000-sample impulse-decay behavioral guard; non-finite, silent, or non-decaying responses throw `RangeError`; coefficients are never clamped.
  - Repeated zeros at z = −1 are verified by residual, root count, and cluster checks rather than root-to-root matching.
- Consequences: Narrow/high-order lowpass/highpass and most order-8 bandpass/bandstop designs are conservatively rejected; filter design must run in a Worker per AGENTS §9, with the UI trigger debounced if needed; a second-order-sections or state-space realization is the future fix; `docs/ALGORITHMS.md` is authoritative for the exact formulas and tolerances.
