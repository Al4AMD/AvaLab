# Wave 3 · Plan 05 — Re/Im spectrum editor (F09)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/tools/spectrum-edit` lab shows Re{X[k]}, Im{X[k]}, |X[k]| and ∠X[k] for the selection, lets the student zero/scale/set selected bands on any of those representations, enforces or breaks Hermitian symmetry, applies presets, and plays the IFFT result.

**Architecture:** New pure dsp module `fourier/spectrumEdit.ts` over the existing `fft`/`ifft`: rectangular analysis window, next-power-of-two zero-pad, edits on bin ranges, optional Hermitian mirroring, IFFT real part. One worker op returns the edited audio plus the post-edit spectra for the charts. Selection is capped at `FFT_MAX_LENGTH` (D-021). Freehand brush drawing is deferred; band + numeric + presets is the approved scope.

**Tech Stack:** As Wave 2. New deps: none.

**Spec:** `AGENTS.md` F09, §9, §11; `docs/DECISIONS.md` D-021; `docs/plans/wave-3/01-playback-and-speed.md`.

## Global Constraints

- No main-thread FFT/IFFT; all edits and inverse transforms run in the worker.
- Rectangular window for editing (documented); no window division after IFFT.
- Hermitian ON keeps the output real; OFF is a teaching mode that reports the imaginary-energy ratio and plays the real part.
- Selection cap 65 536 samples with a visible cap notice.
- All strings through i18n; fa machine-drafted + flagged.
- `pnpm check` + `pnpm e2e` green; both locales; zero console errors.

## Review Focus

1. **Identity** — no edits + Hermitian ON reproduces the input (within FFT round-trip tolerance), including a non-power-of-two selection after zero-pad/truncate.
2. **Representation semantics** — editing magnitude keeps phase; editing phase keeps magnitude; zeroing magnitude zeros both Re and Im; zeroing phase sets phase 0; the UI states this.
3. **Hermitian discipline** — ON mirrors `X[N−k] = conj X[k]`; OFF can produce complex output; the imaginary-energy ratio is shown and the played signal is the real part.
4. **Brick-wall consequences** — zeroing a band produces Gibbs ringing; the UI labels it instead of presenting it as a bug.
5. **Cap + selection** — an empty selection is rejected; a longer selection analyses the first 65 536 samples with a notice; edits are in bins derived from Hz.

---

### Task 1: `spectrumEdit` dsp module

**Files:**
- Create: `packages/dsp/src/fourier/spectrumEdit.ts`
- Modify: `packages/dsp/src/index.ts`
- Create: `packages/dsp/test/fourier/spectrumEdit.test.ts`
- Modify: `docs/ALGORITHMS.md`
- Modify: `tools/golden/` generator + `test-data/golden/spectrum_edit.json`

**Interfaces:**
- `export type SpectrumEditTarget = "re" | "im" | "mag" | "phase";`
- `export type SpectrumEditMode = "zero" | "scale" | "set";`
- `export interface SpectrumEdit { startBin: number; endBin: number; target: SpectrumEditTarget; mode: SpectrumEditMode; value: number; }` — range is `[startBin, endBin)`, clamped to the spectrum.
- `export type SpectrumPreset = "zeroIm" | "zeroRe" | "zeroPhase" | "linearPhase" | "randomPhase" | "magnitudeOnly" | "phaseOnly";`
- `export function buildSpectrumPreset(preset: SpectrumPreset, binCount: number, seed: number): SpectrumEdit[]` — full-range edits; `randomPhase` uses `mulberry32(seed)` uniform phases; `linearPhase` uses `phase = −π·k/binCount`.
- `export interface EditSpectrumParams { fftLengthSamples?: number; edits: readonly SpectrumEdit[]; hermitian: boolean; }`
- `export interface EditSpectrumResult { samples: Float64Array; re: Float64Array; im: Float64Array; magnitude: Float64Array; phase: Float64Array; imaginaryEnergyRatio: number; }`
- Algorithm: `L = fftLengthSamples ?? nextPowerOfTwo(N)` (must be `>= N` and a power of two); frame = input zero-padded to `L`; `X = fft(frame)`; apply edits in order (target mag/phase convert via `m·e^{jφ}`); Hermitian ON mirrors bins `1..L/2−1` and zeroes DC/Nyquist imaginary; `x = real(ifft(X))` truncated to `N`; return post-edit spectra and `imaginaryEnergyRatio = Σ(Im x)² / Σ(Re x)²` before truncation.
- Guards: empty input → `RangeError`; non-finite sample → `TypeError`; bad bin ranges/mode/target/value → `RangeError`; `fftLengthSamples` not a power of two or `< N` → `RangeError`; inputs never mutated.

- [x] **Step 1: Write failing tests** for: no edits + Hermitian ON ≈ input (N = 1000 and N = 1024, tolerance 1e-9); zeroIm on a real input is a no-op; zeroRe produces a zero signal; magnitudeOnly ≈ zeroPhase; phaseOnly has unit magnitude; Hermitian OFF on an asymmetric edit yields non-zero imaginary energy and the returned samples are the real part; preset lengths and random-phase determinism; bad params throw.
- [x] **Step 2: Run** `pnpm --filter @avalab/dsp test -- spectrumEdit` — expected FAIL.
- [x] **Step 3: Implement** and export; add golden generator cases (NumPy reference for zeroIm, zeroRe, zeroPhase, magnitudeOnly, phaseOnly on a fixed 8-sample input).
- [x] **Step 4: Run** the test — expected PASS; add `ALGORITHMS` row.
- [x] **Step 5: Commit** `feat(F09): add spectrum edit dsp module`.

### Task 2: Worker op `spectrumEdit`

**Files:**
- Modify: `apps/web/src/session/ops.ts`
- Modify: `apps/web/src/session/ops.test.ts`
- Modify: `apps/web/src/workers/dsp.worker.ts`

**Interfaces:**
- `export type SpectrumEditParams = { sampleRateHz: number; startSample: number; endSample: number; edits: readonly SpectrumEdit[]; hermitian: boolean };`
- Handler reads the source slice payload, caps at `FFT_MAX_LENGTH`, calls `editSpectrum`, converts samples to Float32, packs `[samples | re | im | mag | phase]` into one Float64 payload.
- Meta `{ sampleCount, fftLengthSamples, binCount, frequencyResolutionHz: sampleRateHz/fftLengthSamples, imaginaryEnergyRatio, capped, editsApplied }`.
- Empty selection → `badParams`; malformed edits → `badParams`.

- [x] **Step 1: Write failing op tests** for packed offsets, no-edit round trip, zeroIm real result, Hermitian-off imaginary ratio > 0, cap notice, empty selection.
- [x] **Step 2: Run** `pnpm --filter @avalab/web test -- ops.test` — expected FAIL.
- [x] **Step 3: Implement** handler + worker case.
- [x] **Step 4: Run** the test — expected PASS.
- [x] **Step 5: Commit** `feat(F09): add spectrum edit worker op`.

### Task 3: Spectrum editor view

**Files:**
- Create: `apps/web/src/features/spectrumEdit/{spectrumEditState.ts,spectrumEditState.test.ts,spectrumEditView.tsx}`
- Modify: `apps/web/src/app/routes.tsx`, `apps/web/src/app/sidebar.tsx`, `apps/web/src/app/routes.test.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`
- Create: `apps/web/e2e/spectrum-edit.spec.ts`

**Interfaces:**
- URL keys: `h` (`0|1` Hermitian), `ed` (compact JSON of edits), `from`/`to`; decoder validates edit shapes and falls back to `[]`.
- Main card requires a source; charts: Re, Im, magnitude, phase (uPlot, `dir="ltr"`).
- Edit builder: band start/end in Hz (converted to bins via `frequencyResolutionHz`), target select, mode select, value input, Add/Remove/Clear; list shows `[startBin, endBin) target mode value`.
- Preset buttons call `buildSpectrumPreset` with the current bin count and seed; the resulting edits replace the list.
- Hermitian toggle; when off, show a translated warning and the `imaginaryEnergyRatio` readout.
- Debounced (200 ms) `spectrumEdit` over selection or first 65 536 samples; empty selection shows the translated hint.
- Playback via `setProcessed(samples, sampleRateHz, "spectrumEdit")`.
- Compact “what to observe” bullets: magnitude vs phase information, Hermitian symmetry, Gibbs ringing from brick-wall masks.
- Route `/tools/spectrum-edit`; `TOOL_IDS` + sidebar.

- [x] **Step 1: Write failing state tests** for URL round-trip, edit validation, Hz→bin conversion, preset replacement, Hermitian flag.
- [x] **Step 2: Run** `pnpm --filter @avalab/web test -- spectrumEditState` — expected FAIL.
- [x] **Step 3: Implement** state + view + route/sidebar + i18n (`spectrumEdit.*`, `nav.spectrumEdit`).
- [x] **Step 4: Run** `pnpm check` — expected PASS.
- [x] **Step 5: Write e2e** `spectrum-edit.spec.ts`: load demo; select a range; add a zero-magnitude band; charts paint; Hermitian off shows warning; preset `zeroIm`; play processed; en locale; zero console errors.
- [x] **Step 6: Run** `pnpm e2e -- spectrum-edit` — expected PASS.
- [x] **Step 7: Commit** `feat(F09): Re/Im spectrum editor`.

### Task 4: Close-out

**Files:**
- Modify: `docs/PROGRESS.md`, `docs/plans/wave-3/README.md`, `docs/ALGORITHMS.md`, `docs/DECISIONS.md` (rectangular-window + real-part fallback semantics)

- [x] **Step 1: Run** full `pnpm check` + `pnpm e2e`; record numbers and fa-review backlog.
- [x] **Step 2: Update** plan status and docs.
- [x] **Step 3: Commit** `docs(F09): close spectrum editor plan`.
