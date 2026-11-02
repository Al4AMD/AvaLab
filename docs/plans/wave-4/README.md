# Wave 4 — Multimedia core

Planned scope (AGENTS §5 M3): F04 compression lab UI (hand-written codecs +
ffmpeg real codecs), F05 metrics UI + rate–distortion plot, codec delay
compensation (cross-correlation alignment), and F06 time-stretch/pitch
verification.

| Plan | Scope | Status |
|---|---|---|
| `01-browser-codec-lab.md` | PCM/WAV helpers, `codecLabProcess` worker op, hand-written codec lab UI | **done** (2026-11-02; commits `15d80ce`..`05f8389`) |
| `02-backend-real-codecs.md` | ffmpeg codec specs, capability probe, `/codec/encode`, delay alignment | **planned** |
| `03-real-codec-ui-and-metrics.md` | Real-codec panel, backend excerpt lane, F05 metrics view | **planned** |
| `04-comparison-rate-distortion-closeout.md` | Comparison table, rate–distortion chart, F06 verification, close-out | **planned** |

Execution order: 01 → 02 → 03 → 04. Plan 01 is browser-only and independent
of the backend. Plan 02 is backend-only and can run in parallel with 01.
Plan 03 depends on both. Plan 04 depends on 01–03.

## Decisions pinned for this wave

- **D-026:** Real-codec input reuses `POST /ingest`; the client uploads a
  mono **16-bit PCM WAV excerpt**. “Bit-exact” means decoded samples equal
  that 16-bit PCM grid reference exactly.
- **D-027:** Codec delay is measured by normalized cross-correlation on the
  first 10 s, searching ±8192 samples. Positive lag means the decoded signal
  is delayed. The backend trims the decoded result and returns the lag,
  reference start, and aligned sample count.
- **D-028:** F05 PSNR uses peak `1.0` (float full scale). Segmental SNR uses
  20 ms frames. Both definitions are shown in the UI and `ALGORITHMS.md`.
- **D-029:** Codec availability is exposed through `GET /health` as
  `codecs: string[]`; the UI disables unavailable encoders instead of
  offering a failing control.
- **D-030:** F06 is already implemented in Wave 3. Wave 4 verifies it with
  e2e coverage and marks it done; no new F06 feature work.
- **D-031:** The comparison batch uses a 30 s excerpt and runs sequentially;
  cancel stops scheduling new points and aborts the in-flight backend call.
  The current worker call cannot be interrupted mid-transform.

## Global gates

- `pnpm check` green.
- `pnpm e2e` green; both `fa` (RTL) and `en` (LTR); zero console errors.
- Backend touched: `uv run --directory apps/api pytest -q`,
  `uv run --directory apps/api ruff check .`, `uv run --directory apps/api mypy .`.
- No main-thread DSP.
- All new strings through i18n; fa copy flagged for owner review.
- No new dependency except the AGENTS-approved `numpy` and `scipy` in
  `apps/api` for alignment and WAV reading.

## Carries

- Persian review for every Wave 4 screen.
- Real-codec e2e is limited by the static-preview harness: pytest covers
  ffmpeg, web unit tests cover the client, e2e covers offline degradation.
- The A/B processed lane holds an excerpt; the UI must label it, never imply
  full-file alignment.
- A full-file phase-vocoder time-stretch can hold ~0.9 GB; the F06 lab keeps
  its 30 s excerpt strategy.
- Pre-existing FFT phase-mask bug from Wave 2 stays out of scope.

Authority order when plans conflict: `AGENTS.md` → `docs/DECISIONS.md` →
this wave plan.
