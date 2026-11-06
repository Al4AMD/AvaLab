# Wave 6 Plan 04 — Remaining Feature Gaps

## Metadata

- Spec: [`design.md`](design.md) §1–§8
- Depends on: plans 00–03
- Scope: F08 butterfly/benchmark/STFT benchmark, F09 curve editing, F12 AM/FM + Fourier-series UI, F14 pitch/beat, F16 theory + guided experiments
- Out of scope: new ML weights, perceptual metrics, pipeline UI (plan 02)

## Global constraints

- All audio math runs in `packages/dsp` behind worker ops; no main-thread DSP.
- Every new op validates finite numbers, lengths, ranges, and 300 s limits.
- New DSP gets golden/property tests and an `ALGORITHMS.md` entry.
- URL decoding is total; old links continue to open.
- Theory and experiments are original bilingual content; formulas use KaTeX.
- No commit.

## Review focus

1. **F08 benchmark honesty:** compare the same transform, same input, same units; report median and error.
2. **F09 curve semantics:** band edits first, curves second; Hermitian enforcement unchanged.
3. **F12 reuse:** no duplicate generator math; exactly the existing `generateAm`/`generateFm`.
4. **F14 isolation:** analysis never touches the model registry or model cache.
5. **F16 completeness:** every P0/P1 tool has theory and 5–8 runnable experiments.

## File map

Create:
- `packages/dsp/src/fourier/butterfly.ts`
- `packages/dsp/test/fourier/butterfly.test.ts`
- `packages/dsp/src/fourier/fftBenchmark.ts`
- `packages/dsp/test/fourier/fftBenchmark.test.ts`
- `packages/dsp/src/fourier/spectrumCurves.ts`
- `packages/dsp/test/fourier/spectrumCurves.test.ts`
- `packages/dsp/src/analysis/pitchBeat.ts` (shared analysis types only; backend owns algorithms)
- `apps/web/src/features/fftview/benchmarkPanel.tsx`
- `apps/web/src/features/fftview/butterflyPanel.tsx`
- `apps/web/src/features/fftview/fftBenchmark.test.tsx`
- `apps/web/src/features/spectrumEdit/curveCanvas.tsx`
- `apps/web/src/features/spectrumEdit/curveState.ts`
- `apps/web/src/features/spectrumEdit/curveState.test.ts`
- `apps/web/src/features/generator/amFmPanel.tsx`
- `apps/web/src/features/generator/fourierPanel.tsx`
- `apps/web/src/features/generator/generatorPanels.test.tsx`
- `apps/web/src/features/ai/pitchBeatTab.tsx`
- `apps/web/src/features/ai/pitchBeat.test.tsx`
- `apps/web/src/features/theory/theoryContent.ts`
- `apps/web/src/features/theory/theoryContent.test.ts`
- `apps/api/src/avalab_api/analysis/__init__.py`
- `apps/api/src/avalab_api/analysis/pitch.py`
- `apps/api/src/avalab_api/analysis/beat.py`
- `apps/api/tests/test_analysis.py`
- `apps/web/e2e/fftBenchmark.spec.ts`
- `apps/web/e2e/spectrumCurves.spec.ts`
- `apps/web/e2e/generatorAmFm.spec.ts`
- `apps/web/e2e/pitchBeat.spec.ts`
- `apps/web/e2e/theoryExperiments.spec.ts`

Modify:
- `packages/dsp/src/index.ts`
- `packages/dsp/src/fourier/spectrumEdit.ts`
- `packages/dsp/package.json` (`fft.js`)
- `apps/web/src/session/ops.ts`
- `apps/web/src/workers/dsp.worker.ts`
- `apps/web/src/features/fftview/fftView.tsx`
- `apps/web/src/features/spectrumEdit/spectrumEditView.tsx`
- `apps/web/src/features/generator/{generatorState.ts,generatorView.tsx}`
- `apps/web/src/features/ai/{aiState.ts,aiLabView.tsx,aiClient.ts}`
- `apps/web/src/features/education/{experiments.ts,experimentsView.tsx}`
- `apps/web/src/i18n/en.json`
- `apps/web/src/i18n/fa.json`
- `apps/api/src/avalab_api/ml/models.py`
- `apps/api/src/avalab_api/ml/jobs.py`
- `apps/api/src/avalab_api/routes/ml.py`
- `apps/api/pyproject.toml`
- `docs/ALGORITHMS.md`
- `docs/DECISIONS.md`
- `docs/THIRD_PARTY.md`
- `docs/PROGRESS.md`

## Task 1 — F08 butterfly steps

**Files:** `butterfly.ts`, tests

1. Define:
   ```ts
   export interface ButterflyStep {
     readonly stage: number;
     readonly butterflyIndex: number;
     readonly inputEven: number;
     readonly inputOdd: number;
     readonly twiddleRe: number;
     readonly twiddleIm: number;
     readonly outputEvenRe: number;
     readonly outputEvenIm: number;
     readonly outputOddRe: number;
     readonly outputOddIm: number;
   }
   export function fftButterflySteps(real: Float64Array, imag: Float64Array): ButterflyStep[];
   ```
2. Accept only power-of-two lengths 8 and 16; throw `RangeError` otherwise. Return steps in execution order, matching the radix-2 DIT/DIF layout used by `fftRadix2`.
3. Tests:
   - N=8 and N=16 step counts are `N/2 * log2(N)`.
   - Replaying the steps reproduces `fftRadix2` within `1e-12`.
   - Non-power-of-two and >16 throw.
4. Run `pnpm --filter @avalab/dsp exec vitest run test/fourier/butterfly.test.ts`.

## Task 2 — F08 benchmark

**Files:** `fftBenchmark.ts`, tests, `ops.ts`, worker, UI

1. Add dependency `fft.js` pinned to `4.0.4` (MIT) in `packages/dsp/package.json`; adapt it in `fftBenchmark.ts` only.
2. Define:
   ```ts
   export interface FftBenchmarkResult {
     readonly fftLengthSamples: number;
     readonly iterations: number;
     readonly oursMedianMs: number;
     readonly libraryMedianMs: number;
     readonly speedRatio: number;
     readonly maxAbsError: number;
   }
   export function benchmarkFft(fftLengthSamples: number, iterations: number): FftBenchmarkResult;
   ```
   Sizes `256 | 1024 | 4096 | 16384`; iterations default 10; warm up once; use `performance.now()`; deterministic input from a seeded LCG.
3. `stftBenchmarkChunk` op:
   - Params `{ fftLengthSamples, hopSamples, startSample, frameCount }`.
   - Payload: source Float32.
   - Result `{ framesProcessed, elapsedMs, checksum }`.
   - Validates frame count 1..512 and bounds.
4. Store helper `runStftBenchmark` loops chunks (256 frames), reports `{framesDone, framesTotal}` progress, supports cancel between chunks, and returns `{frames, elapsedMs, throughputFramesPerSecond}`.
5. Tests:
   - Benchmark results finite, `iterations + 1` transforms per implementation, error `<= 1e-5`.
   - Speed ratio is `ours / library`, no divide-by-zero.
   - Chunk op rejects bad params/bounds; loop reaches the expected frame count; cancel stops early.
6. UI:
   - Benchmark panel in `fftView`: table (N, ours ms, fft.js ms, ratio, max error), run button, progress/cancel for STFT.
   - Butterfly panel: N selector 8/16, step forward/back, stage readout, twiddle values, before/after values.
7. Tests `fftBenchmark.test.tsx`: run renders rows; cancel leaves a terminal state; no console errors.
8. Run `pnpm --filter @avalab/web exec vitest run src/features/fftview/fftBenchmark.test.tsx` and `pnpm --filter @avalab/dsp exec vitest run test/fourier/fftBenchmark.test.ts`.

## Task 3 — F09 curve editing

**Files:** `spectrumCurves.ts`, tests, `spectrumEdit.ts`, `ops.ts`, `curveState.ts`, `curveCanvas.tsx`, view

1. Define:
   ```ts
   export type SpectrumCurveTarget = "re" | "im" | "mag" | "phase";
   export interface SpectrumCurvePoint {
     readonly bin: number;
     readonly value: number;
   }
   export interface SpectrumCurveEdit {
     readonly target: SpectrumCurveTarget;
     readonly points: readonly SpectrumCurvePoint[];
   }
   export function applySpectrumCurves(
     spectrum: { re: Float64Array; im: Float64Array },
     curves: readonly SpectrumCurveEdit[],
     binCount: number,
   ): void;
   ```
2. Rules:
   - Curves are applied after band edits.
   - Points sorted by bin; duplicate bins last wins; at least 2 points; max 256 points per curve; max 8 curves.
   - Linear interpolation between points; constant before the first and after the last point.
   - `re`/`im`: set the component; `mag`: set magnitude, keep phase; `phase`: set angle in radians, keep magnitude.
   - Magnitude is clamped to `>= 0`; angles wrapped to `[-π, π]`.
   - Non-finite values are rejected, never silently dropped.
3. Tests:
   - Two-point constant magnitude curve changes exactly the covered bins.
   - Phase curve preserves magnitude.
   - Re/Im curves round-trip through IFFT.
   - Band edits then curves order is observable.
   - Bad points/limits throw.
4. Extend `SpectrumEditParams` with `curves?: readonly SpectrumCurveEdit[]` and pass to `editSpectrum`; no change when absent.
5. `curveState.ts`:
   - URL key `cv` = JSON array; cap 8192 chars; decode invalid entries individually; legacy `ed` remains.
   - Add/remove/clear points; target select.
6. UI:
   - Draw mode overlay on magnitude/phase chart; pointer adds points; drag moves the nearest point; click bin readout.
   - Buttons: clear curve, undo last point, apply.
   - The edit list stays visible; curves are separate from band edits.
7. Tests: URL round-trip, invalid `cv` falls back to empty, legacy `ed` still applies.
8. Run `pnpm --filter @avalab/web exec vitest run src/features/spectrumEdit/curveState.test.ts src/session/ops.test.ts` and `pnpm --filter @avalab/dsp exec vitest run test/fourier/spectrumCurves.test.ts`.

## Task 4 — F12 AM/FM and Fourier-series UI

**Files:** `generatorState.ts`, `generatorView.tsx`, panels, tests

1. Add `"am" | "fm"` to `SynthWaveform` and `GENERATOR_WAVEFORMS`.
2. Add settings: `modulationHz` (0.1–20 000), `modulationIndex` (0–10), `frequencyDeviationHz` (0–20 000), `fourierKind` (`square|sawtooth|triangle`), `fourierHarmonics` (1–200).
3. URL keys: `mh`, `mi`, `dev`, `fk`, `fh`; storage unchanged; total decode.
4. Generator tabs: `basic` (existing waveforms), `amFm`, `fourier`.
5. `amFmPanel`:
   - AM: reuse `generateAm({ carrierHz: frequencyHz, modulationHz, modulationIndex, amplitude })`.
   - FM: reuse `generateFm({ carrierHz: frequencyHz, modulationHz, frequencyDeviationHz, amplitude })`.
   - Show a warning when `modulationIndex > 1` (overmodulation).
6. `fourierPanel`:
   - Reuse `fourierSeriesPartialSum` and `measureGibbsOvershoot`.
   - Harmonic slider 1–200; show the overshoot percentage and the theoretical 8.95 %.
   - Compare with the ideal square/sawtooth/triangle from generators.
7. Tests:
   - AM/FM params round-trip through URL.
   - Op dispatch uses the correct generator for each waveform.
   - Harmonics clamp and Gibbs readout finite.
8. Run `pnpm --filter @avalab/web exec vitest run src/features/generator/generatorPanels.test.tsx`.

## Task 5 — F14 pitch and beat tracking

**Files:** API models/jobs/routes, analysis modules, tests, web AI tab

1. API types:
   ```python
   AnalysisTask = Literal["pitch", "beat"]
   JobTask = MlTask | AnalysisTask
   MlResult.kind: Literal["audio", "stems", "transcript", "analysis"]
   ```
   `MlResult.analysis: dict[str, object] | None`.
2. `analysis/pitch.py`:
   - `run(samples, sample_rate_hz, params, progress) -> MlResult` with `librosa.pyin` (`fmin=65`, `fmax=1000`, `sr=sample_rate_hz`, `frame_length=2048`).
   - Return `{kind: "analysis", analysis: {analysis_kind: "pitch", times_s: [...], f0_hz: [...], voiced_probability: [...]}, stats: {median_f0_hz, voiced_fraction}}`.
3. `analysis/beat.py`:
   - `librosa.beat.beat_track`; return `{analysis_kind: "beat", tempo_bpm, beat_times_s}`.
4. Job manager: `_Job.task: JobTask`; `submit(task: JobTask, ...)`; `_persist` handles `kind == "analysis"` by returning `{kind:"analysis", analysis: result.analysis, stats: result.stats}`; no audio persisted.
5. Route:
   - `ANALYSIS_TASKS = {"pitch", "beat"}`.
   - For analysis tasks call `avalab_api.analysis.<task>.run`; no registry, no model check.
   - Keep `_check_excerpt` for both.
   - `GET /models` unchanged (five model tasks only).
6. Tests:
   - Synthetic 220 Hz sine → median F0 within 2 Hz and voiced-probability array length matches F0.
   - Click train at 120 BPM → tempo within 2 BPM and beat times sorted.
   - Analysis job returns `kind=analysis` and no `result_audio_id`.
   - `GET /models` has exactly five rows.
   - Analysis still rejects >30 s.
7. Add `librosa` to base dependencies in `apps/api/pyproject.toml`; record version/license in `docs/THIRD_PARTY.md`.
8. Web:
   - `AiState` task union adds `"pitch" | "beat"`; sixth tab `pitchBeat`.
   - New tab runs the analysis job, polls SSE, renders an F0 curve (canvas) or beat list, and shows stats.
   - No model banner for analysis; progress and cancel work.
   - Result `kind=analysis` is handled in `aiClient` result union.
9. Run `uv run pytest apps/api/tests/test_analysis.py -q`, `uv run ruff check apps/api`, `uv run mypy apps/api`, `pnpm --filter @avalab/web exec vitest run src/features/ai/pitchBeat.test.tsx`.

## Task 6 — F16 theory panels

**Files:** `theoryContent.ts`, all tool views, i18n

1. `theoryContent.ts` maps tool id → `{ titleKey, sections }`. Sections contain heading key, body key, optional formula, optional bullets.
2. Required tools: waveform, spectrogram, sampling, extent, fftview, spectrum-edit, speed, reverb, filters (already), generator, codec-lab, metrics, ai (per task, extend existing), pipeline, psychoacoustics.
3. Formulas (original prose, referenced only):
   - Sampling: `x[n] = x(nT_s)`, Nyquist `f_s > 2 f_max`.
   - Extent: `E = Σ |x[n]|^2`, `P = E/N`, `Δf = f_s/N`.
   - FFT: `X[k] = Σ x[n] e^{-j2πkn/N}`.
   - Speed: resampling changes both rate and pitch; phase vocoder preserves pitch.
   - Reverb: `y[n] = (x*h)[n]`.
   - Codec lab: entropy `H = -Σ p log2 p`, bitrate `R = bits/s`.
   - Metrics: `SNR = 10 log10(P_s/P_e)`, PSNR peak definition.
   - Pipeline: composition `y = f_K ∘ ... ∘ f_1(x)`.
   - Psychoacoustics: masking threshold and Bark scale (plan 01 owns detail).
4. Render `<TheoryPanel>` in each view; keep the existing filters/AI panels.
5. Every key exists in both locales; no hard-coded strings.
6. Tests:
   - Every required tool id has at least 2 sections and 1 formula where applicable.
   - Key check passes.
7. Run `pnpm check`.

## Task 7 — F16 guided experiments

**Files:** `experiments.ts`, `experimentsView.tsx`, i18n, e2e

1. Expand `ExperimentId` to: `waveform-spectrogram`, `sampling`, `extent`, `fft`, `spectrum-edit`, `speed`, `reverb`, `filters`, `generator-fourier`, `codec-lab`, `metrics`, `ai-separation`, `ai-denoise`, `ai-superres`, `ai-asr`, `ai-neural-codec`, `ai-pitch-beat`, `pipeline`, `psychoacoustics`.
2. Each experiment: goal + 5–8 steps; each step has an instruction, expected observation, and optional deep link with valid URL params. FFT, codec lab, filters, spectrum editor, AI, pipeline, and psychoacoustics get 8 steps; the others get at least 5.
3. Add categories in the view: Signals & Systems, Multimedia, AI, Labs. Keep the existing three experiments and extend them to 5 steps.
4. Persist completion per experiment in `localStorage["avalab.experiments.progress"]` (IDs only).
5. Tests:
   - Every experiment has 5–8 steps.
   - Every link path exists in `TOOL_IDS` or `experiments`.
   - Progress toggles and persists; invalid stored JSON resets.
6. `theoryExperiments.spec.ts`: every experiment card opens; each step link navigates; progress survives reload; both locales.
7. Run `pnpm --filter @avalab/web e2e -- theoryExperiments.spec.ts`.

## Task 8 — Documentation and gates

1. Add butterfly, FFT benchmark, spectrum curves, pitch/beat, theory/experiment notes to `docs/ALGORITHMS.md` (backend analysis references librosa).
2. Record `fft.js` (MIT) and `librosa` (ISC) in `docs/THIRD_PARTY.md`.
3. Record decisions in `docs/DECISIONS.md`.
4. Run `pnpm check`, `pnpm --filter @avalab/web e2e -- fftBenchmark.spec.ts spectrumCurves.spec.ts generatorAmFm.spec.ts pitchBeat.spec.ts theoryExperiments.spec.ts`, API pytest/ruff/mypy.
5. Update `docs/PROGRESS.md`; do not commit.
