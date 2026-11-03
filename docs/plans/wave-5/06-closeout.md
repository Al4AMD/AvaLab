# Wave 5 · Plan 06 — Close-out

**Status:** pending.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wave 5 is complete when every gate is green, the offline/model story is proven, docs are honest, and the owner has a review list.

**Architecture:** No new feature code. This plan only verifies, documents, and fixes defects found by the gates. No scope expansion.

**Spec:** `AGENTS.md` §13 Definition of Done; `docs/plans/wave-5/README.md`.

## Global Constraints

- Do not mark work done without running the command in this session.
- No push/deploy unless the owner asks.
- No model weights or generated audio committed beyond the small CC0 demo excerpts.
- Fix only Wave 5 defects; log unrelated findings in `PROGRESS.md`.

## Review Focus

1. **Offline** — `HF_HUB_OFFLINE=1` with a pre-populated cache starts the API and lists models.
2. **Missing cache** — a clean cache starts the API; AI tools disable honestly.
3. **Docker** — CPU image installs the `ml` extra and ffmpeg is available; smoke `/health` and `/models`.
4. **Persian** — every new screen renders RTL; formulas/plots LTR; review list is complete.
5. **Docs truth** — claimed model behavior matches measured behavior; SSL/ETA numbers are labeled estimates.

---

### Task 1: Full static and unit gates

- [ ] **Step 1: Run** `pnpm check` — lint, typecheck, dsp/web/scripts tests, i18n parity. Fix failures.
- [ ] **Step 2: Run** `uv run --directory apps/api pytest -q` — default suite without heavy models. Fix failures.
- [ ] **Step 3: Run** `uv run --directory apps/api ruff check .` and `uv run --directory apps/api mypy .` — fix failures.
- [ ] **Step 4: Run** `pnpm e2e` — both locales, zero console errors. Fix failures.
- [ ] **Step 5: Commit** `test(F14/F11/F16): pass wave 5 gates`.

### Task 2: Model and offline smoke

- [ ] **Step 1: Run** `uv run --directory apps/api python scripts/download_models.py --check` — expected: all five specs listed, cache state reported, no download.
- [ ] **Step 2: If models are cached, run** `AVALAB_RUN_ML_TESTS=1 uv run --directory apps/api pytest -q -m ml` — record pass/skip per model.
- [ ] **Step 3: Run** `HF_HUB_OFFLINE=1 uv run --directory apps/api uvicorn avalab_api.main:app --port 8001` and `curl /api/v1/models` — expected: list with `available`, no network attempt.
- [ ] **Step 4: With an empty cache, start the API and open `/tools/ai` — expected: tabs render, run disabled, reason key shown.**
- [ ] **Step 5: Record measured CPU latency for denoise, super-resolution, separation, ASR, and neural codec on the demo excerpts in `docs/MODELS.md`; label estimates as estimates.**
- [ ] **Step 6: Commit** `test(F14): record model and offline smoke`.

### Task 3: Docker CPU smoke

- [x] **Step 1: Build** `docker compose build api web` — expected: succeeds with the `ml` extra.
- [x] **Step 2: Start** `docker compose up -d`; `curl /api/v1/health` — expected: `ffmpeg: true`, codecs list.
- [x] **Step 3: `curl /api/v1/models` — expected: five models, cache state honest.**
- [x] **Step 4: Open the web app; load a demo; open `/tools/ai` — expected: no console errors.**
- [x] **Step 5: Record image size and any CPU-only caveats in `PROGRESS.md`; stop containers.**
- [x] **Step 6: Commit** `test(F14): verify docker cpu smoke` if docs changed.

### Task 4: Documentation and review list

- [ ] **Step 1: Update `docs/MODELS.md`** with final revisions, licenses (including LavaSR/htdemucs gaps), sizes, input/output rates, CPU timings, and limitations.
- [ ] **Step 2: Update `docs/DECISIONS.md`** with D-032–D-038 final text and any implementation deviations.
- [ ] **Step 3: Update `docs/ALGORITHMS.md`** with F11 design/apply details, sinc baseline, WER normalization, and Encodec estimate formula.
- [ ] **Step 4: Update `docs/THIRD_PARTY.md`** with KaTeX, ML packages, and demo asset provenance.
- [ ] **Step 5: Update `docs/PROGRESS.md`** with done/partial/cut, known issues, Persian review list, next-wave recommendation.
- [ ] **Step 6: Update `docs/plans/wave-5/README.md`** statuses and commit ranges.
- [ ] **Step 7: Commit** `docs(F14/F11/F16): close wave 5`.

### Task 5: Final verification

- [ ] **Step 1: Re-run** `pnpm check`, `pnpm e2e`, API pytest/ruff/mypy after all docs changes.
- [ ] **Step 2: Confirm no model weights/large audio/secrets in `git status`.**
- [ ] **Step 3: Confirm all Wave 5 plan checkboxes are checked or explicitly deferred.**
- [ ] **Step 4: Report exact commands and outcomes to the owner.**
- [ ] **Step 5: Do not push.**

## Completion Gate

- All static, unit, e2e, backend, and gated model checks pass or have a documented skip.
- `HF_HUB_OFFLINE=1` and empty-cache paths both verified.
- Docker CPU smoke passes.
- Docs match measured behavior.
- Owner has the Persian review list and known-limitations list.
