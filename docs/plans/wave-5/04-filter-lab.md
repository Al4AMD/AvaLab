# Wave 5 · Plan 04 — Filter-design lab (F11)

**Status:** pending.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** F11 filter-design UI: FIR/window, Butterworth, Chebyshev I and RBJ biquad design; magnitude/phase/group-delay plots; pole-zero/stability; apply to the source with preview.

**Architecture:** One new `filterDesign` worker op returns coefficients and analysis arrays from the existing `packages/dsp` filter code. One `filterApply` op applies FIR (FFT convolution) or IIR (direct form) and reports delay. `features/filters/` owns state/URL and the view. No new DSP algorithm is written.

**Tech Stack:** Existing `@avalab/dsp` filters (`designFirWindow`, `designButterworth`, `designChebyshev1`, biquads, `freqz`, `groupDelaySamples`, `impulseResponse`, `stepResponse`, `polesZeros`, `isStable`, `applyFilter`, `convolveFft`), uPlot, React.

**Spec:** `AGENTS.md` F11, §11; `docs/plans/wave-5/README.md`.

## Global Constraints

- All computation in the DSP worker; no main-thread filtering.
- Use existing algorithms; no new filter math.
- Units in names and labels: `cutoffHz`, `order`, `groupDelaySamples`, `rippleDb`.
- Filter design for 30 s audio under 300 ms; applying full 5-min audio may show progress.
- Plots and numeric readouts LTR in both locales.
- All strings through i18n; Persian flagged.

## Review Focus

1. **Stability** — IIR designs with unstable poles are rejected or clearly marked; no silent NaN output.
2. **Nyquist validation** — cutoff/center must stay in `(0, fs/2)`; invalid values fall back or error, never alias silently.
3. **FIR symmetry/delay** — linear-phase FIR reports and compensates delay when previewing; length/order relationship matches the DSP contract.
4. **Apply scope** — selection vs whole file is explicit; processed lane labels the excerpt; no truncation without notice.
5. **Pole-zero plot** — unit circle and axes LTR; points outside the circle visibly flagged.

---

### Task 1: Filter design worker op

**Files:**
- Modify: `apps/web/src/session/ops.ts`
- Create: `apps/web/src/session/ops.filterDesign.test.ts`

**Interfaces:**
- `FilterDesignKind = "fir" | "butterworth" | "chebyshev1" | "biquad"`.
- `FilterBand = "lowpass" | "highpass" | "bandpass" | "bandstop" | "notch"`.
- `FilterDesignParams = { kind; band; cutoffHz; cutoff2Hz?; order; taps; window: "hamming"|"blackman"|"kaiser"; rippleDb; q; gainDb; sampleRateHz }`.
- `FilterDesignResult = { b: number[]; a: number[]; frequenciesHz: number[]; magnitudeDb: number[]; phaseRad: number[]; groupDelaySamples: number[]; impulse: number[]; step: number[]; poles: {re,im}[]; zeros: {re,im}[]; stable: boolean; delaySamples: number }`.
- Dispatch: FIR → `designFirWindow` (`taps`, not `order`); Butterworth/Chebyshev → `designButterworth`/`designChebyshev1`; biquad → RBJ by band; analysis via `freqz`/`groupDelaySamples`/`impulseResponse`/`stepResponse`/`polesZeros`/`isStable`.
- Validation: finite params, `0 < cutoff < Nyquist`, order 1–8 (FIR taps 3–257, odd), positive Q.
- Pole-zero roots are computed for IIR designs; for FIR they are computed only when `taps <= 33` (higher degrees are expensive in the root solver), otherwise the arrays stay empty and the UI says roots are omitted.

- [ ] **Step 1: Write failing op tests** for a 1 kHz low-pass at 48 kHz: magnitude near 0 dB at 100 Hz, below -20 dB at 8 kHz; FIR impulse symmetry; Butterworth poles inside unit circle; invalid cutoff throws `badParams`.
- [ ] **Step 2: Run** `pnpm --filter @avalab/web exec vitest run src/session/ops.filterDesign` — expected FAIL.
- [ ] **Step 3: Implement the op** and export its types.
- [ ] **Step 4: Run** focused test + `pnpm check` — expected PASS.
- [ ] **Step 5: Commit** `feat(F11): add filter design worker op`.

### Task 2: Filter apply worker op

**Files:**
- Modify: `apps/web/src/session/ops.ts`
- Create: `apps/web/src/session/ops.filterApply.test.ts`

**Interfaces:**
- `FilterApplyParams = { b: number[]; a: number[]; fir: boolean; sampleRateHz: number; compensateDelay: boolean }`.
- `FilterApplyResult = { samples: Float32Array; sampleRateHz: number; delaySamples: number }`.
- FIR: `convolveFft` with the impulse response; trim `delaySamples` when `compensateDelay`.
- IIR: `applyFilter`; report `groupDelaySamples` at DC/low frequency as metadata, but do not trim causal response.

- [ ] **Step 1: Write failing tests** for an impulse through a known FIR (output equals coefficients), a sine through a low-pass (attenuation), length/delay contract, and empty input rejection.
- [ ] **Step 2: Run** focused test — expected FAIL.
- [ ] **Step 3: Implement the op.**
- [ ] **Step 4: Run** focused test + `pnpm check` — expected PASS.
- [ ] **Step 5: Commit** `feat(F11): add filter apply worker op`.

### Task 3: Filter state, URL, localStorage

**Files:**
- Create: `apps/web/src/features/filters/filterState.ts`
- Create: `apps/web/src/features/filters/filterState.test.ts`

**Interfaces:**
- `FilterSettings` mirrors the design params plus `applyScope: "selection" | "all"`.
- Defaults: lowpass Butterworth, 4 kHz at 48 kHz, order 4, Hamming, 0.5 dB ripple, Q 0.707, 0 dB gain.
- `filterSettingsToSearch`, `filterSettingsFromSearch` use `lib/url-state`; booleans as `0/1`; per-field fallback.
- `FILTER_STORAGE_KEY = "avalab.filters.last"`; load/save best-effort.

- [ ] **Step 1: Write tests** for round-trip, unknown values, cutoff clamped to Nyquist, and localStorage fallback.
- [ ] **Step 2: Run** focused test — expected FAIL.
- [ ] **Step 3: Implement state codec.**
- [ ] **Step 4: Run** focused test + `pnpm check` — expected PASS.
- [ ] **Step 5: Commit** `feat(F11): add filter lab state and URL codec`.

### Task 4: Filter lab view

**Files:**
- Create: `apps/web/src/features/filters/filterLabView.tsx`
- Create: `apps/web/src/features/filters/filterLabView.test.tsx`
- Create: `apps/web/src/features/filters/filterPlots.tsx`
- Create: `apps/web/src/features/filters/poleZeroPlot.tsx`
- Modify: `apps/web/src/app/routes.tsx`
- Modify: `apps/web/src/app/sidebar.tsx`
- Modify: `apps/web/src/i18n/en.json`
- Modify: `apps/web/src/i18n/fa.json`

**Interfaces:**
- Controls: design kind, band, cutoff/center, second cutoff for band filters, order/taps, window, ripple, Q, gain.
- Plots: magnitude dB, phase rad, group delay samples, impulse, step; `dir="ltr"`; axes with units.
- Pole-zero SVG: unit circle, poles `×`, zeros `○`, stable badge; LTR; omitted-roots note for large FIR designs.
- Apply: selection or all; runs `filterApply`; `setProcessed`; shows delay and excerpt label.
- Uses `useSessionStore` for source/selection/derive; no direct worker calls from components.

- [ ] **Step 1: Write component tests** with a fake store: controls render, invalid cutoff disabled, apply calls the op with expected params, unstable design shows warning, plots receive finite arrays.
- [ ] **Step 2: Run** focused tests — expected FAIL.
- [ ] **Step 3: Implement view/plots + route + `nav.filters` + `filters.*` keys.**
- [ ] **Step 4: Run** `pnpm check` — expected PASS.
- [ ] **Step 5: Commit** `feat(F11): add filter design lab`.

### Task 5: E2E, performance, docs

**Files:**
- Create: `apps/web/e2e/filters.spec.ts`
- Modify: `apps/web/e2e/tools.spec.ts`
- Modify: `docs/ALGORITHMS.md`
- Modify: `docs/PROGRESS.md`

- [ ] **Step 1: Add e2e** for `/tools/filters`: load chirp demo, design low-pass, see plots, apply, no console errors; both locales.
- [ ] **Step 2: Add a performance assertion** or a documented measurement for 30 s design under 300 ms.
- [ ] **Step 3: Document the design/apply formulas and delay handling.**
- [ ] **Step 4: Run** `pnpm check`, `pnpm e2e` — expected PASS.
- [ ] **Step 5: Commit** `test(F11): verify filter lab e2e`.

## Completion Gate

- FIR, Butterworth, Chebyshev I, and biquad paths work.
- Magnitude/phase/group-delay/impulse/step/pole-zero plots are finite and LTR.
- Unstable/invalid designs are rejected or flagged.
- Apply-to-selection and apply-to-all both work through the store.
- E2E both locales; no console errors.
