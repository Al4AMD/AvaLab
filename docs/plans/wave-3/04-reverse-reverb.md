# Wave 3 · Plan 04 — Reverse and reverb (F10)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/tools/reverb` lab keeps “reverse” (time reversal) and “reverb” (convolution with an impulse response) distinct: reverse shows the magnitude/phase change, reverb offers synthetic and uploaded IRs, pre-delay, wet/dry mix, FFT vs direct convolution timing, and a flip-and-slide convolution visualization.

**Architecture:** `convolveDirect` and `convolveFft` already exist. This plan adds one deterministic synthetic-IR generator to `packages/dsp` and two worker ops: `reverbProcess` (source ++ optional uploaded IR in one payload) and `convolutionSteps` (tiny teaching visualization). Reverse reuses Plan 03’s `extentProcess` op.

**Tech Stack:** As Wave 2. New deps: none.

**Spec:** `AGENTS.md` F10, §9, §11; `docs/plans/wave-3/03-signal-extent.md`.

## Global Constraints

- “Reverse” and “reverb” are never conflated in UI copy or docs (AGENTS F10).
- Convolution runs in the worker; no main-thread convolution, even for the visualization (the tiny step op is worker-side).
- IR upload uses the existing browser decode seam (`browserDecodeWav` + `monoDownmix`); no new decoder.
- Uploaded IR cap: 10 s, mono, finite; reject longer with a translated message.
- All strings through i18n; fa machine-drafted + flagged.
- `pnpm check` + `pnpm e2e` green; both locales; zero console errors.

## Review Focus

1. **Convolution tail** — output length must be `N + preDelay + M − 1`; the last `M − 1` samples are the tail, not dropped. Wet/dry mix must pad the dry signal to the same length.
2. **Direct vs FFT honesty** — direct convolution is offered only on a ≤ 2 s excerpt; the timing table must label what was measured.
3. **IR determinism and level** — the synthetic IR is deterministic for a seed and energy-normalized; the same preset does not change level between runs.
4. **Reverse is not reverb** — the reverse card shows `y[n] = x[N−1−n]`, magnitude unchanged, phase conjugated plus linear phase; no wet/dry controls there.
5. **Uploaded IR safety** — bad/empty/oversized IRs reject with translated errors; the session source is never mutated.

---

### Task 1: Synthetic IR generator

**Files:**
- Create: `packages/dsp/src/systems/impulseResponse.ts`
- Modify: `packages/dsp/src/index.ts`
- Create: `packages/dsp/test/systems/impulseResponse.test.ts`
- Modify: `docs/ALGORITHMS.md`

**Interfaces:**
- `export type SyntheticIrKind = "room" | "hall" | "plate" | "telephone";`
- `export interface SyntheticIrParams { kind: SyntheticIrKind; sampleRateHz: number; durationSeconds: number; rt60Seconds: number; seed: number; }`
- `export function generateSyntheticIr(params: SyntheticIrParams): Float64Array`
- Formula: `t = n / fs`; `env = exp(-6.907755278982137 * t / rt60Seconds)`; white noise from `mulberry32(seed)`; multiply; add early reflections for `room`/`hall` (taps at 7/11/17/23 ms, gains 0.5/0.35/0.25/0.18); `telephone` applies a 300 Hz high-pass and 3400 Hz low-pass using the existing biquad design + `applyFilter`; finally normalize energy to 1 (`sum(h²) = 1`), all-zero → `RangeError`.
- `durationSeconds > 0`, `rt60Seconds > 0`, `sampleRateHz` finite positive integer, `seed` finite; else `RangeError`. Deterministic for identical params.

- [ ] **Step 1: Write failing tests** for determinism (same seed → identical), different seeds differ, length `round(duration·fs)`, energy ≈ 1, decay fit (late-window RMS lower than early-window), telephone spectrum attenuated below 300 Hz and above 3400 Hz relative to 1 kHz, bad params throw.
- [ ] **Step 2: Run** `pnpm --filter @avalab/dsp test -- impulseResponse` — expected FAIL.
- [ ] **Step 3: Implement** and export.
- [ ] **Step 4: Run** the test — expected PASS; add `ALGORITHMS` row (property-tested; RNG stream is JS-specific, so no cross-language golden — documented).
- [ ] **Step 5: Commit** `feat(F10): add deterministic synthetic impulse response generator`.

### Task 2: Worker ops `reverbProcess` and `convolutionSteps`

**Files:**
- Modify: `apps/web/src/session/ops.ts`
- Modify: `apps/web/src/session/ops.test.ts`
- Modify: `apps/web/src/workers/dsp.worker.ts`

**Interfaces:**
- `export type ReverbIrParams = { kind: SyntheticIrKind; durationSeconds: number; rt60Seconds: number; seed: number };`
- `export type ReverbProcessParams = { sampleRateHz: number; startSample: number; endSample: number; ir: ReverbIrParams; uploadedIrSampleCount: number; preDelayMs: number; wetMix: number; method: "fft" | "direct" };`
- Payload: source slice, followed by uploaded IR samples when `uploadedIrSampleCount > 0`; otherwise built-in IR is generated.
- `preDelaySamples = round(preDelayMs · fs / 1000)`; `delayed = zeros(preDelaySamples) ++ x`; `wet = convolve(delayed, ir)` with `convolveFft` (default) or `convolveDirect`.
- `outputLength = delayed.length + ir.length − 1`; `dry = x` zero-padded to `outputLength`; `y = (1 − wetMix)·dry + wetMix·wet`.
- `wetMix` finite in `[0, 1]`; `preDelayMs` finite `>= 0`; direct method rejects input > 2 s (`badParams`); output duration > `MAX_PROCESSED_SECONDS` → `tooLong`.
- Result meta `{ outputSampleCount, irSampleCount, elapsedMs, method, preDelaySamples }`; Float32 payload.
- `export type ConvolutionStepsParams = { signal: readonly number[]; ir: readonly number[] };`
- `ConvolutionStepsResult` payload = `M` partial arrays of length `N+M−1`, each `partial_m[m+i] = signal[i]·ir[m−i]` for valid `i`; meta `{ signalSampleCount, irSampleCount, stepCount, outputSampleCount }`. Sum of partials equals `convolveDirect(signal, ir)` (tested).

- [ ] **Step 1: Write failing op tests**: impulse input + delta IR → identity; output length tail; wetMix 0 returns dry, wetMix 1 returns wet; direct vs FFT agree within 1e-6 on a 1 s excerpt; uploaded IR split works; direct > 2 s throws; `convolutionSteps` partials sum to direct convolution.
- [ ] **Step 2: Run** `pnpm --filter @avalab/web test -- ops.test` — expected FAIL.
- [ ] **Step 3: Implement** both handlers + worker cases.
- [ ] **Step 4: Run** the test — expected PASS.
- [ ] **Step 5: Commit** `feat(F10): add reverb and convolution-step worker ops`.

### Task 3: Reverb lab view

**Files:**
- Create: `apps/web/src/features/reverb/{reverbState.ts,reverbState.test.ts,reverbView.tsx}`
- Modify: `apps/web/src/app/routes.tsx`, `apps/web/src/app/sidebar.tsx`, `apps/web/src/app/routes.test.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`
- Create: `apps/web/e2e/reverb.spec.ts`

**Interfaces:**
- URL keys: `ir` (`room|hall|plate|telephone|upload`), `rt` (RT60 s), `du` (IR duration s), `sd` (seed), `pd` (pre-delay ms), `wm` (wet mix), `me` (`fft|direct`), `from`/`to`.
- Main card requires a source; IR preset select + RT60/duration/seed inputs; uploaded IR file input (decode seam, mono downmix, ≤10 s); pre-delay, wet/dry, method toggle.
- Debounced (250 ms) `reverbProcess` over selection or first 30 s; explicit whole-file apply (may hit the 300 s processed cap → translated notice).
- IR panel: waveform + spectrum (via `fftSelection` standalone).
- Result panel: waveform + spectrogram (via `spectrogramTiles` standalone); elapsed time; direct-method note.
- Timing card: run FFT and direct on the same ≤2 s excerpt and show both `elapsedMs` values; disable direct for longer excerpts.
- Flip-and-slide card: fixed tiny excerpt (e.g. 24 samples) + IR (6 taps), step slider over `convolutionSteps` partials.
- Reverse card: apply `extentProcess` `{ operation: "reverse" }`; before/after magnitude and phase charts via `fftSelection`; note magnitude unchanged, phase conjugated + linear phase.
- Compact “what to observe” bullets; reverse/reverb terminology kept distinct.
- Route `/tools/reverb`; `TOOL_IDS` + sidebar.

- [ ] **Step 1: Write failing state tests** for URL round-trip, preset defaults, clamps.
- [ ] **Step 2: Run** `pnpm --filter @avalab/web test -- reverbState` — expected FAIL.
- [ ] **Step 3: Implement** state + view + route/sidebar + i18n (`reverb.*`, `nav.reverb`).
- [ ] **Step 4: Run** `pnpm check` — expected PASS.
- [ ] **Step 5: Write e2e** `reverb.spec.ts`: load demo; apply hall preset; processed badge + result spectrogram; wet/dry change; step slider advances; reverse card charts; en locale; zero console errors.
- [ ] **Step 6: Run** `pnpm e2e -- reverb` — expected PASS.
- [ ] **Step 7: Commit** `feat(F10): reverse and reverb lab`.

### Task 4: Close-out

**Files:**
- Modify: `docs/PROGRESS.md`, `docs/plans/wave-3/README.md`, `docs/ALGORITHMS.md`, `docs/DECISIONS.md` (IR level normalization + upload cap)

- [ ] **Step 1: Run** full `pnpm check` + `pnpm e2e`; record numbers and fa-review backlog.
- [ ] **Step 2: Update** plan status and docs.
- [ ] **Step 3: Commit** `docs(F10): close reverse and reverb plan`.
