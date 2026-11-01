# Wave 3 · Plan 03 — Signal extent (F07)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/tools/extent` lab shows duration, sample count, support, energy, average power and energy/power classification, and applies shift, time-scale, reverse, truncate, zero-pad and periodic extension while showing the spectral consequences (Δf, leakage, zero-padding interpolation, time–bandwidth trade-off).

**Architecture:** The Wave 1 `signals/extent.ts` functions already implement shift/scale/reverse/truncate/zero-pad/support/energy/power/classification. This plan adds `periodicExtend` and one worker op that dispatches the operations and returns analysis metadata. Spectra reuse the existing `fftSelection` op through `deriveStandalone` on copied transformed payloads; no second FFT implementation.

**Tech Stack:** As Wave 2. New deps: none.

**Spec:** `AGENTS.md` F07, §9, §10; `docs/plans/wave-3/01-playback-and-speed.md`.

## Global Constraints

- DSP only in the worker; `packages/dsp` pure and tested.
- Energy/power units are amplitude-squared; UI prints “full-scale²” when the source is in `[-1, 1]`.
- `timeScale` intentionally has no anti-alias filter (teaching demo); the UI must say so and point to F03 for a band-limited resampler.
- All strings through i18n; fa machine-drafted + flagged.
- `pnpm check` + `pnpm e2e` green; both locales; zero console errors.

## Review Focus

1. **Support and classification edge cases** — silence, one-sided support, constants, empty input, and a signal touching both window edges must classify exactly as `extent.ts` documents.
2. **Zero-padding is interpolation, not new information** — the padded spectrum must keep the same main-lobe width while sampling it more densely; the UI must not claim improved resolution.
3. **Truncation changes resolution** — shorter support widens the main lobe; the Δf readout is `fs/N` of the transformed length.
4. **Periodic extension** — repeating the finite signal creates a line spectrum at multiples of `1/T`; the comparison must not silently use a different window.
5. **Cap and memory** — scale/zero-pad output longer than 300 s is rejected by the processed-lane/store cap with a translated message; preview defaults to the selection or 30 s.

---

### Task 1: `periodicExtend` dsp helper

**Files:**
- Modify: `packages/dsp/src/signals/extent.ts`
- Modify: `packages/dsp/src/index.ts`
- Modify: `packages/dsp/test/signals/extent.test.ts`
- Modify: `docs/ALGORITHMS.md`
- Modify: `tools/golden/` generator + `test-data/golden/extent.json`

**Interfaces:**
- `export function periodicExtend(samples: FloatArray, repetitions: number): Float64Array` — output `[x, x, …, x]` repeated `repetitions` times, length `N·repetitions`.
- `repetitions` integer `>= 1`; `N·repetitions` a safe integer; non-finite sample → `TypeError`; bad repetitions → `RangeError`; `N = 0` → empty.
- Golden case: `[1, 2, 3]`, repetitions `3` → `[1,2,3,1,2,3,1,2,3]`; single repetition is identity.

- [x] **Step 1: Write failing tests** for identity, repetition count, empty input, non-finite sample, bad repetitions.
- [x] **Step 2: Run** `pnpm --filter @avalab/dsp test -- extent` — expected FAIL.
- [x] **Step 3: Implement** and export; extend the golden generator and regenerate.
- [x] **Step 4: Run** dsp tests — expected PASS; add `ALGORITHMS` row.
- [x] **Step 5: Commit** `feat(F07): add periodic extension helper`.

### Task 2: Worker op `extentProcess`

**Files:**
- Modify: `apps/web/src/session/ops.ts`
- Modify: `apps/web/src/session/ops.test.ts`
- Modify: `apps/web/src/workers/dsp.worker.ts`

**Interfaces:**
- `export type ExtentOperation = { operation: "identity" } | { operation: "shift"; shiftSamples: number } | { operation: "scale"; factor: number } | { operation: "reverse" } | { operation: "truncate"; startSampleIndex: number; lengthSamples: number } | { operation: "zeroPad"; padStartSamples: number; padEndSamples: number } | { operation: "periodicExtend"; repetitions: number };`
- `export type ExtentProcessParams = { sampleRateHz: number } & ExtentOperation;`
- `export type ExtentProcessResult = { meta: { outputSampleCount: number; durationSeconds: number; supportStartSample: number; supportEndSample: number; energy: number; averagePower: number; signalType: "energy" | "power"; elapsedMs: number }; payload?: TransferablePayload };`
- Handler reads the source slice payload, applies exactly one dsp extent function (identity copies), converts to Float32, computes `support(x, { threshold: 0 })`, `signalEnergy`, `averagePower`, `classifySignalType`.
- Output longer than `MAX_PROCESSED_SECONDS` → `DspOpError("tooLong", …)`.
- Bad params (`factor <= 0`, negative pads, bad repetition) → `badParams`.

- [x] **Step 1: Write failing op tests** for each operation on a 1 s ramp/impulse: shift moves support; scale 2 halves duration; reverse flips; truncate shortens; zeroPad adds zeros and keeps energy; periodicExtend triples length; classification `energy` for an interior pulse and `power` for a constant; `tooLong` for an oversized pad.
- [x] **Step 2: Run** `pnpm --filter @avalab/web test -- ops.test` — expected FAIL.
- [x] **Step 3: Implement** the handler + worker case.
- [x] **Step 4: Run** the test — expected PASS.
- [x] **Step 5: Commit** `feat(F07): add signal extent worker op`.

### Task 3: Signal extent lab view

**Files:**
- Create: `apps/web/src/features/extent/{extentState.ts,extentState.test.ts,extentView.tsx}`
- Modify: `apps/web/src/app/routes.tsx`, `apps/web/src/app/sidebar.tsx`, `apps/web/src/app/routes.test.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`
- Create: `apps/web/e2e/extent.spec.ts`

**Interfaces:**
- URL keys: `op` (`identity|shift|scale|reverse|truncate|zeroPad|periodic`), `sh` (shift samples), `sf` (scale factor), `ts`/`tl` (truncate start/length), `ps`/`pe` (pads), `rp` (repetitions), `from`/`to` (source range). Decoder clamps and falls back per field.
- Main card requires a source; controls per operation; default `identity`.
- Debounced (200 ms) `extentProcess` over the selection or first 30 s; explicit whole-file apply.
- Readouts: duration, sample count, support range, energy, average power, `energy | power` badge.
- Before/after waveform canvases (reuse `paintWaveform`) with the support region highlighted.
- Before/after spectra: copy source/transformed payloads and call `deriveStandalone("fftSelection", { windowFamily: "hann", windowLengthSamples: analysisLength, magnitudeMode: "db", phaseMode: "wrapped", … }, payload)`; for zero-pad use the padded payload and the original analysis length; for truncation use the truncated payload.
- Readout `Δf = fs / fftLengthSamples`; notes for leakage, zero-padding interpolation, time–bandwidth trade-off.
- Periodic-extension card: show repeated waveform + line-spectrum note.
- Play processed via Plan 01 lane.
- Compact “what to observe” bullets.
- Route `/tools/extent`; `TOOL_IDS` + sidebar.

- [x] **Step 1: Write failing state tests** for URL round-trip and operation-specific defaults/clamps.
- [x] **Step 2: Run** `pnpm --filter @avalab/web test -- extentState` — expected FAIL.
- [x] **Step 3: Implement** state + view + route/sidebar + i18n (`extent.*`, `nav.extent`).
- [x] **Step 4: Run** `pnpm check` — expected PASS.
- [x] **Step 5: Write e2e** `extent.spec.ts`: load demo; shift; assert support readout changes; zero-pad; assert spectrum chart paints and Δf readout updates; periodic extension; processed badge; en locale; zero console errors.
- [x] **Step 6: Run** `pnpm e2e -- extent` — expected PASS.
- [x] **Step 7: Commit** `feat(F07): signal extent lab`.

### Task 4: Close-out

**Files:**
- Modify: `docs/PROGRESS.md`, `docs/plans/wave-3/README.md`, `docs/ALGORITHMS.md`

- [x] **Step 1: Run** full `pnpm check` + `pnpm e2e`; record numbers and fa-review backlog.
- [x] **Step 2: Update** plan status and docs.
- [x] **Step 3: Commit** `docs(F07): close signal extent plan`.

## Shipped (2026-11-01)

- `periodicExtend` dsp helper with golden vector and 12 tests; `extentProcess` worker op (seven operations, output cap before allocation, analysis metadata) with 11 tests; `/tools/extent` lab with URL codec (`op,sh,sf,ts,tl,ps,pe,rp,from,to`), selection/first-30-s preview vs whole-file apply, readouts (duration, samples, support, energy, average power, energy/power badge, Δf), support-highlighted before/after waveforms, sequential before/after uPlot spectra, periodic-extension card, processed playback, and compact observe bullets.
- Semantics: energy/power are amplitude-squared (UI prints “full-scale²” for normalized sources); `timeScale` has no anti-alias filter by design and the UI points to F03; zero-padding is labelled interpolation (same main-lobe width, denser sampling), not new resolution.
- Gates: `pnpm check` exit 0 (dsp 919/919, web 256/256, scripts 13/13, i18n OK, biome 176 files); `pnpm e2e` 33/33 with zero console errors in fa + en, including both extent-lab locales and the seven-route sidebar sweep. Perf on the same run: overview first paint 219 ms (< 1000 ms), spectrogram first tiles 302 ms (< 3000 ms).
- Carries: `extent.*` Persian copy needs owner review (added to the fa backlog); the view runs the before- and after-spectrum analyses sequentially because identical concurrent RPC params supersede each other; freehand/brush editing and full theory panels remain deferred.
- **Next step:** Wave 3 plan 04 — `docs/plans/wave-3/04-reverse-reverb.md`.
