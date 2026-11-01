# Wave 3 · Plan 02 — Sampling rate and bit depth (F03)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/tools/sampling` lab demonstrates resampling with and without the anti-alias filter, bit-depth reduction with optional TPDF dither, measured vs theoretical quantization SNR, the residual signal, and an interactive aliasing demo that shows the fold-back frequency.

**Architecture:** All math already exists in `packages/dsp` (`resampleRational`, `quantizeUniform`, `quantizeWithTpdfDither`, `quantizationError`, `mse`, `snrDb`, `segmentalSnrDb`, `psnrDb`, `generateSine`). This plan adds one analytic helper (`aliasFrequencyHz`) and two worker ops that compose the existing functions. Playback uses Plan 01's processed lane; residual playback is the error signal.

**Tech Stack:** As Wave 2. New deps: none.

**Spec:** `AGENTS.md` F03, §9, §10; `docs/plans/wave-3/01-playback-and-speed.md`.

## Global Constraints

- DSP only in the worker; no main-thread resampling/quantization.
- Quantizer bit range is the dsp contract `[1, 24]`; the UI exposes `1..16` per F03 and rejects anything else.
- PSNR peak is `1.0` (full-scale float) and the UI prints that definition.
- SNR theory is `6.02·bits + 1.76` dB for a full-scale sine; the UI must label that assumption.
- All strings through i18n; fa machine-drafted + flagged.
- `pnpm check` + `pnpm e2e` green; both locales; zero console errors.

## Review Focus

1. **Anti-alias toggle actually changes the result** — `filter: "none"` must show/hear aliasing; the spectrum test pins a fold-back component that disappears with `"kaiserSinc"`.
2. **SNR honesty** — measured SNR is against the resampled reference, not the original when the rate changed; theory is shown only with its full-scale-sine assumption.
3. **Residual is the difference signal** — playback of `original − quantized` at the same rate; never a re-quantized copy.
4. **Rate limits** — target rates must be positive integers when they differ from the source; the op rejects bad rates and the UI explains.
5. **Aliasing demo is source-free** — it works before any file is loaded, uses `deriveStandalone`, and cleans up stale generations on slider ticks.

---

### Task 1: `aliasFrequencyHz` helper

**Files:**
- Create: `packages/dsp/src/signals/aliasing.ts`
- Modify: `packages/dsp/src/index.ts`
- Create: `packages/dsp/test/signals/aliasing.test.ts`
- Modify: `docs/ALGORITHMS.md`

**Interfaces:**
- `export function aliasFrequencyHz(inputFrequencyHz: number, sampleRateHz: number): number` — returns `|f − fs·round(f/fs)|` in `[0, fs/2]`.
- Both arguments finite, `sampleRateHz > 0`; else `RangeError`.
- Nyquist input (`f = fs/2`) returns `fs/2`; `f = fs` returns 0.

- [x] **Step 1: Write failing tests** for `f = 1000, fs = 8000 → 1000`; `f = 5000, fs = 8000 → 3000`; `f = 9000, fs = 8000 → 1000`; `f = 4000 → 4000`; `f = 8000 → 0`; negative frequency uses absolute value; non-finite/zero rate throws.
- [x] **Step 2: Run** `pnpm --filter @avalab/dsp test -- aliasing` — expected FAIL.
- [x] **Step 3: Implement** the formula and export it.
- [x] **Step 4: Run** the test — expected PASS; add the `ALGORITHMS` row.
- [x] **Step 5: Commit** `feat(F03): add alias frequency helper`.

### Task 2: Worker ops `samplingProcess` and `aliasDemo`

**Files:**
- Modify: `apps/web/src/session/ops.ts`
- Modify: `apps/web/src/session/ops.test.ts`
- Modify: `apps/web/src/workers/dsp.worker.ts`

**Interfaces:**
- `export type SamplingProcessParams = { sampleRateHz: number; startSample: number; endSample: number; targetRateHz: number; antiAlias: boolean; bits: number; dither: boolean; seed: number };`
- `export type SamplingProcessResult = { meta: { outputSampleCount: number; sampleRateHz: number; mse: number; snrDb: number; segmentalSnrDb: number; psnrDb: number; theorySnrDb: number; capped: boolean }; payload?: TransferablePayload };`
- Handler:
  1. Read Float32 source payload.
  2. `resampleRational(x, { inputRateHz: params.sampleRateHz, outputRateHz: params.targetRateHz, filter: params.antiAlias ? "kaiserSinc" : "none" })`.
  3. `quantizeUniform(resampled, { bits })` or `quantizeWithTpdfDither(resampled, { bits, seed })`.
  4. `error = quantizationError(resampled, quantized)`.
  5. Metrics against the resampled reference: `mse`, `snrDb`, `segmentalSnrDb`, `psnrDb({ peak: 1 })`; `theorySnrDb = 6.02·bits + 1.76`.
  6. Payload = `[quantized N | error N]` Float32; meta carries `sampleCount` implicitly by `outputSampleCount`.
- `export type AliasDemoParams = { sourceRateHz: number; targetRateHz: number; frequencyHz: number; durationSeconds: number; antiAlias: boolean };`
- `export type AliasDemoResult = { meta: { aliasFrequencyHz: number; measuredPeakHz: number; outputSampleCount: number }; payload?: TransferablePayload };`
- `aliasDemo` generates a sine at `sourceRateHz`, resamples to `targetRateHz` with the chosen filter, measures the dominant FFT bin of the output, and returns the Float32 samples.

- [x] **Step 1: Write failing op tests** for: 1 s 440 Hz at 48 kHz → 8 kHz, anti-alias off keeps a 440 Hz peak; 1 s 5 kHz at 48 kHz → 8 kHz, anti-alias on removes the 3 kHz fold-back while off shows it; quantize 16 bits on a full-scale sine gives SNR within 3 dB of `6.02·16 + 1.76`; dither changes the error sequence; payload contains `2N` floats; bad bits/rate throws `badParams`.
- [x] **Step 2: Run** `pnpm --filter @avalab/web test -- ops.test` — expected FAIL.
- [x] **Step 3: Implement** both handlers + worker cases.
- [x] **Step 4: Run** the test — expected PASS.
- [x] **Step 5: Commit** `feat(F03): add sampling and aliasing worker ops`.

### Task 3: Sampling lab view

**Files:**
- Create: `apps/web/src/features/sampling/{samplingState.ts,samplingState.test.ts,samplingView.tsx}`
- Modify: `apps/web/src/app/routes.tsx`, `apps/web/src/app/sidebar.tsx`, `apps/web/src/app/routes.test.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`
- Create: `apps/web/e2e/sampling.spec.ts`

**Interfaces:**
- URL keys: `tr` (targetRateHz), `aa` (`0|1`), `bd` (bits), `dt` (`0|1`), `seed`, `from`, `to`. Decoder clamps bits to `1..16`, rate to `1000..96000`, and falls back per field.
- Main card requires a source: target-rate select (`48000`, `44100`, `22050`, `16000`, `8000`, `4000`, `1000`, custom), anti-alias toggle, bit-depth slider, dither toggle.
- Debounced (200 ms) `samplingProcess` over the selection or first 30 s; “apply to whole file” explicit.
- Readouts: measured SNR, segmental SNR, PSNR (with peak = 1.0 note), theory SNR, MSE, output duration.
- Error chart: uPlot line of the error payload; before/after waveform mini-canvases.
- Buttons: play processed (`setProcessed`), play residual (`setProcessed(error)`), reset.
- Aliasing card: source-free, frequency slider `0..2·targetRateHz`, predicted alias via `aliasFrequencyHz`, measured peak, anti-alias toggle, play result; uses `deriveStandalone("aliasDemo", ...)`.
- Compact “what to observe” bullets: aliasing, dither noise floor, `6.02N + 1.76`.
- Route `/tools/sampling`; `TOOL_IDS` + sidebar.

- [x] **Step 1: Write failing state tests** for URL round-trip, clamps, defaults.
- [x] **Step 2: Run** `pnpm --filter @avalab/web test -- samplingState` — expected FAIL.
- [x] **Step 3: Implement** state + view + route/sidebar + i18n (`sampling.*`, `nav.sampling`).
- [x] **Step 4: Run** `pnpm check` — expected PASS.
- [x] **Step 5: Write e2e** `sampling.spec.ts`: load demo; set 8 kHz + anti-alias off; assert SNR readout and error chart; play residual (processed badge); aliasing card changes predicted value; en locale; zero console errors.
- [x] **Step 6: Run** `pnpm e2e -- sampling` — expected PASS.
- [x] **Step 7: Commit** `feat(F03): sampling and bit-depth lab`.

### Task 4: Close-out

**Files:**
- Modify: `docs/PROGRESS.md`, `docs/plans/wave-3/README.md`, `docs/ALGORITHMS.md`, `docs/DECISIONS.md` (only if a semantic was pinned beyond this plan)

- [x] **Step 1: Run** full `pnpm check` + `pnpm e2e`; record measured numbers and fa-review backlog in `PROGRESS`.
- [x] **Step 2: Update** plan status and docs.
- [x] **Step 3: Commit** `docs(F03): close sampling and bit-depth plan`.

## Shipped (2026-11-01)

- `aliasFrequencyHz` helper with golden tests; `samplingProcess` (resample with/without anti-alias, uniform/TPDF quantization, metrics against the resampled reference, residual payload) and source-free `aliasDemo` worker ops; `/tools/sampling` URL/state/view with rate presets, anti-alias and dither toggles, bit depth 1..16, SNR/segmental/PSNR/theory/MSE readouts, error chart, before/after mini waveforms, processed + residual playback, aliasing card, and reset.
- Semantics pinned by D-023: metrics compare quantized output with the RESAMPLED reference; residual = reference − quantized; theory SNR is labelled full-scale-sine; the aliasing card computes source-free and its play button appears after a source exists because it installs into the shared processed lane.
- Audit close-out clamped the frequency sent to `aliasDemo` to `2 × targetRateHz`, so the readout and generated audio agree after lowering the target rate.
- Gates after audit: `pnpm check` exit 0 (dsp 951/951, web 286/286, scripts 13/13, i18n OK, biome 188 files); `pnpm e2e` 37/37 with zero console errors in fa + en. Perf on that run: overview first paint 396 ms (< 1000 ms), spectrogram first tiles 495 ms (< 3000 ms).
- Carries: `sampling.*` Persian copy needs owner review; the compare slot is unchanged.
- **Next step:** Wave 3 plan 03 — `docs/plans/wave-3/03-signal-extent.md`.
