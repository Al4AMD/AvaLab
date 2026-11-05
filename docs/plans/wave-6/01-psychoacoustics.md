# Wave 6 Plan 01 — F13 Psychoacoustics and Masking-Aware MDCT

## Metadata

- Spec: [`design.md`](design.md) §6
- Depends on: plan 00
- Scope: F13 model, masking-aware MDCT mode, codec-lab integration, new tool
- Out of scope: real MP3/AAC encoder, temporal masking, tonal/noise masking separation

## Global constraints

- Legacy `encodeMdct`/`decodeMdct` output and goldens remain byte-identical.
- The new mode is explicit; an absent URL flag means legacy uniform quantization.
- Every model formula is documented in `docs/ALGORITHMS.md` with its limitation.
- All audio analysis runs in the worker; the view holds no DSP.
- No commit.

## Review focus

1. **Formula fidelity:** Bark, ATH, spreading, band level, threshold, SMR match the golden reference.
2. **Calibration:** `P_ref` is measured through the same MDCT, not hard-coded.
3. **Backward compatibility:** old codec-lab links and legacy goldens are unchanged.
4. **Accounting:** entropy bits and side-info bits are shown separately and summed honestly.
5. **Teaching honesty:** the UI labels the model as stationary and approximate.

## File map

Create:
- `tools/golden/src/avalab_golden/algorithms/psychoacoustics.py`
- `tools/golden/tests/test_psychoacoustics.py`
- `packages/dsp/test-data/golden/psychoacoustics.json` (generated)
- `packages/dsp/src/psychoacoustics/bark.ts`
- `packages/dsp/src/psychoacoustics/ath.ts`
- `packages/dsp/src/psychoacoustics/masking.ts`
- `packages/dsp/src/psychoacoustics/index.ts`
- `packages/dsp/src/codecs/mdctPsycho.ts`
- `packages/dsp/test/psychoacoustics/bark.test.ts`
- `packages/dsp/test/psychoacoustics/ath.test.ts`
- `packages/dsp/test/psychoacoustics/masking.test.ts`
- `packages/dsp/test/codecs/mdctPsycho.test.ts`
- `apps/web/src/features/psychoacoustics/psychoacousticsState.ts`
- `apps/web/src/features/psychoacoustics/psychoacousticsView.tsx`
- `apps/web/src/features/psychoacoustics/psychoacousticsState.test.ts`
- `apps/web/src/features/psychoacoustics/psychoacousticsView.test.tsx`
- `apps/web/src/features/psychoacoustics/theory.ts`
- `apps/web/e2e/psychoacoustics.spec.ts`

Modify:
- `tools/golden/src/avalab_golden/algorithms/__init__.py`
- `packages/dsp/src/index.ts`
- `packages/dsp/src/codecs/mdctCodec.ts` (read-only reference; no behavior change)
- `apps/web/src/session/ops.ts`
- `apps/web/src/workers/dsp.worker.ts`
- `apps/web/src/session/ops.psychoacoustics.test.ts`
- `apps/web/src/features/codecLab/codecLabState.ts`
- `apps/web/src/features/codecLab/codecLabState.test.ts`
- `apps/web/src/features/codecLab/codecLabView.tsx`
- `apps/web/src/features/codecLab/codecLabView.test.tsx` (new focused view test)
- `apps/web/src/app/routes.tsx`
- `apps/web/src/app/sidebar.tsx`
- `apps/web/src/features/theory/*` wiring
- `apps/web/src/i18n/en.json`
- `apps/web/src/i18n/fa.json`
- `docs/ALGORITHMS.md`
- `docs/DECISIONS.md`
- `docs/PROGRESS.md`

## Task 1 — Python golden reference

**Files:** `tools/golden/src/avalab_golden/algorithms/psychoacoustics.py`, `tools/golden/tests/test_psychoacoustics.py`, `algorithms/__init__.py`

1. Implement NumPy helpers in the generator:
   - `hz_to_bark(f)` with the Zwicker–Terhardt formula.
   - `bark_to_hz(z)` by deterministic bisection in `[0, 0.5 * sample_rate_hz]`.
   - `ath_db(f)` with the Terhardt formula, clamp `f` to `[20, nyquist]`.
   - `spreading_db(delta_bark)`; vectorized over arrays.
   - `band_edges_hz(sample_rate_hz)` for 25 bands at `z = 0..25`.
2. Cases in `cases()`:
   - `bark_edges_48k`: 26 edges for 48 kHz.
   - `bark_edges_8k`: 26 edges clamped at 4 kHz; empty bands allowed.
   - `ath_points`: frequencies `[20, 100, 1000, 4000, 10000, 20000]`.
   - `spreading_points`: `delta_bark` from `-10` to `+10` step `2.5`.
   - `band_levels`: deterministic coefficients for a 512-sample frame; expected levels, thresholds, SMR for 48 kHz.
3. Register `"psychoacoustics"` in `GENERATORS`.
4. Tests pin the edge count, ATH monotonicity on `[20, 1000]` and rise above 10 kHz, spreading symmetry, and deterministic JSON.
5. Run `pnpm gen:golden` and `uv run --directory tools/golden pytest -q`.
6. Confirm `packages/dsp/test-data/golden/psychoacoustics.json` exists and is stable across two runs.

## Task 2 — Bark, ATH, and masking DSP

**Files:** `packages/dsp/src/psychoacoustics/*`, tests, `src/index.ts`

1. `bark.ts` exports:
   ```ts
   export function hzToBark(hz: number): number;
   export function barkToHz(bark: number, sampleRateHz: number): number;
   export function barkBandEdgesHz(sampleRateHz: number, bandCount?: number): Float64Array;
   export function barkBandIndexOf(hz: number): number;
   ```
   Guards: finite, `hz >= 0`, `sampleRateHz > 0`, `bandCount >= 1`; `barkToHz` clamps `z` to `[0, 25]` and result to `[0, nyquist]`.
2. `ath.ts` exports:
   ```ts
   export function absoluteThresholdDb(frequencyHz: number): number;
   export function bandAthDb(edgesHz: Float64Array): Float64Array;
   ```
   `bandAthDb` uses each band center `sqrt(fLow * fHigh)`; empty bands carry the center threshold.
3. `masking.ts` exports:
   ```ts
   export function spreadingDb(deltaBark: number): number;
   export function bandLevelsDb(
     coefficients: Float64Array,
     edgesHz: Float64Array,
     refSplDb: number,
     referencePower: number,
   ): { levelsDb: Float64Array; binCounts: Int32Array };
   export function maskingThresholdDb(
     levelsDb: Float64Array,
     bandCentersBark: Float64Array,
     athDb: Float64Array,
   ): Float64Array;
   export function signalToMaskRatioDb(levelsDb: Float64Array, thresholdsDb: Float64Array): Float64Array;
   export function maskStepForBand(thresholdDb: number, refSplDb: number, referencePower: number, binCount: number): number;
   ```
   `maskStepForBand` returns `Infinity` for `binCount === 0`; the codec replaces that with the global step.
4. `index.ts` re-exports all public functions and types; add to `packages/dsp/src/index.ts`.
5. Tests:
   - `bark.test.ts`: golden edge values at 48 k and 8 k; monotonic `hzToBark`; `barkToHz(hzToBark(f)) ≈ f` on `[20, nyquist-1]`; invalid inputs throw typed errors.
   - `ath.test.ts`: golden points; all values finite; 20 Hz and 20 kHz above the 4 kHz minimum.
   - `masking.test.ts`: golden band levels/threshold/SMR; threshold `>=` ATH at every band; silence yields no NaN; empty band `maskStepForBand` is `Infinity`.
6. Run `pnpm --filter @avalab/dsp exec vitest run test/psychoacoustics`.
7. Checkpoint: all DSP tests pass.

## Task 3 — Masking-aware MDCT codec

**Files:** `packages/dsp/src/codecs/mdctPsycho.ts`, `packages/dsp/test/codecs/mdctPsycho.test.ts`, `src/index.ts`

1. Define:
   ```ts
   export const PSYCHO_BAND_COUNT = 25;
   export const PSYCHO_REFERENCE_SPL_DB = 94;
   export const PSYCHO_SIDE_INFO_BITS_PER_BAND = 16;

   export interface MdctPsychoParams extends MdctCodecEncodeParams {
     readonly frameLengthSamples: number;
     readonly bitsPerSecond: number;
     readonly referenceSplDb?: number;
   }

   export interface MdctPsychoBandStat {
     readonly bandIndex: number;
     readonly lowHz: number;
     readonly highHz: number;
     readonly binCount: number;
     readonly levelDb: number;
     readonly thresholdDb: number;
     readonly smrDb: number;
     readonly step: number;
     readonly masked: boolean;
   }

   export interface MdctPsychoFrameStat {
     readonly frameIndex: number;
     readonly bands: readonly MdctPsychoBandStat[];
     readonly entropyBits: number;
     readonly sideInfoBits: number;
     readonly totalBits: number;
     readonly maskedFraction: number;
   }

   export interface MdctPsychoEncoded extends MdctCodecEncoded {
     readonly bandEdgesHz: Float64Array;
     readonly bandSteps: Float64Array[];
     readonly frameStats: readonly MdctPsychoFrameStat[];
     readonly stats: MdctCodecStats & {
       readonly entropyBits: number;
       readonly sideInfoBits: number;
       readonly totalBits: number;
       readonly maskedFraction: number;
     };
   }

   export function measureReferencePower(sampleRateHz: number, frameLengthSamples: number): number;
   export function encodeMdctPsycho(samples: Float32Array, params: MdctPsychoParams): MdctPsychoEncoded;
   export function decodeMdctPsycho(encoded: MdctPsychoEncoded, params: MdctCodecDecodeParams): Float32Array;
   ```
2. `measureReferencePower`:
   - Generate exactly `sampleRateHz` samples of a 1 kHz full-scale sine at the given rate.
   - Run `mdct` with `frameLengthSamples`.
   - Return the mean over frames of `sum(C_k^2) / hop`.
   - Throw for non-finite/non-positive rate or invalid frame length.
3. Encode:
   - Reuse `mdct` from `timestretch/mdct`.
   - For each frame, compute band edges, levels, ATH, thresholds, SMR.
   - `sGlobal = GM * 2 ** (-bitsPerSecond / sampleRateHz)` using the legacy nonzero-GM rule with `GM = 1` and `sGlobal = 1` for an empty frame.
   - `s_i = max(sMask_i, sGlobal)`, except empty bands use `sGlobal`.
   - Quantize `q_k = clip(round(C_k / s_band), -32768, 32767)`.
   - Zigzag and canonical Huffman exactly as legacy; copy the 6-line private zigzag with a `ponytail:` comment naming the legacy duplication.
   - `entropyBits = bitLength` of the Huffman stream.
   - `sideInfoBits = frameCount * PSYCHO_BAND_COUNT * PSYCHO_SIDE_INFO_BITS_PER_BAND`.
   - `totalBits = entropyBits + sideInfoBits`.
   - `maskedFraction = maskedBinCount / coefficientCount` (`0` when empty).
   - `stats.bitrateKbps = totalBits * sampleRateHz / sampleCount / 1000`.
   - `stats.bitsPerSample = totalBits / sampleCount`.
   - `compressedSizeBytes = ceil(entropyBits / 8)`.
4. Decode:
   - Validate container, split the stream at `frameCount * hop` (same as legacy).
   - Un-zigzag, multiply by `bandSteps[frame][band]`, run `imdct`, trim to `(frameCount - 1) * hop`.
   - Reject missing band steps for a non-empty frame.
5. Tests:
   - Legacy regression: `encodeMdct` output on the existing fixture is byte-identical before/after this plan.
   - Deterministic encode: same input twice gives identical `bits`, `steps`, `bandSteps`.
   - Round-trip: decode reproduces the quantized coefficient indices for all frames; audio length is exact.
   - Silence: no NaN/Infinity; `maskedFraction` finite; `totalBits === sideInfoBits + entropyBits`.
   - Empty input: zero stats, empty arrays.
   - Non-finite samples/params throw typed errors.
   - A high threshold must produce a step `>= sGlobal`; masked bands never have a step below the global rate step.
7. Run `pnpm --filter @avalab/dsp exec vitest run test/codecs/mdctPsycho.test.ts test/codecs/mdctCodec.test.ts`.

## Task 4 — Worker ops for the codec and F13 analysis

**Files:** `apps/web/src/session/ops.ts`, `dsp.worker.ts`, `ops.psychoacoustics.test.ts`

1. Extend `CodecLabParams`:
   ```ts
   mdctPsychoacoustic: boolean;
   mdctReferenceSplDb: number;
   ```
   Validate `mdctReferenceSplDb` in `[80, 100]`.
2. `codecLabProcess`:
   - For `codec === "mdct"` and `mdctPsychoacoustic`, call `encodeMdctPsycho`/`decodeMdctPsycho`.
   - For legacy mode, keep the existing path byte-identical.
   - Add meta fields:
     ```ts
     psychoacoustic: boolean;
     mdctEntropyBits: number | null;
     mdctSideInfoBits: number | null;
     mdctMaskedFraction: number | null;
     mdctBands: { lowHz: number; highHz: number; thresholdDb: number; smrDb: number; step: number }[] | null;
     ```
   - `compressedSizeBytes` stays the payload bytes; `bitrateKbps` for psycho mode includes side info.
3. Add `psychoacousticCurves` op:
   - Params `{ sampleRateHz: number; referenceSplDb: number }`.
   - No payload.
   - Returns `{ bandEdgesHz, bandCentersHz, bandCentersBark, athDb, spreadingDb: Float64Array }` where `spreadingDb` is the `25 x 25` matrix flattened.
4. Add `psychoacousticAnalysis` op:
   - Params `{ sampleRateHz, startSample, endSample, referenceSplDb }`.
   - Payload: selected mono Float32 samples.
   - Returns `{ frameCount, bands: { lowHz, highHz, levelDb, thresholdDb, smrDb }[] }` for the loudest frame by band-energy sum.
   - Reject empty or >30 s selections.
5. Register both ops in `dspOps`, the worker handler map, and the switch.
6. Tests:
   - Legacy codec params default `mdctPsychoacoustic: false`; existing tests unchanged.
   - Psycho params produce `psychoacoustic: true` and finite meta.
   - Invalid reference SPL rejects `badParams`.
   - Curves op returns 26 edges, 25 centers, 25×25 spreading.
   - Analysis op picks the loudest frame and rejects a >30 s payload.
7. Run `pnpm --filter @avalab/web exec vitest run src/session/ops.psychoacoustics.test.ts src/session/ops.test.ts`.

## Task 5 — Codec-lab URL state and UI

**Files:** `codecLabState.ts`, `codecLabState.test.ts`, `codecLabView.tsx`

1. Add settings:
   ```ts
   mdctPsychoacoustic: boolean;
   mdctReferenceSplDb: number;
   ```
   Defaults: `true`, `94`.
2. URL flags:
   - `pm=1` for psycho, `pm=0` for legacy.
   - Absent `pm` => `false` (legacy), so Wave 4 links keep their result.
   - `rspl=94`, clamped to `[80, 100]`; absent/invalid => `94`.
3. Include both fields in stale checks.
4. Pass both fields to `codecLabProcess`.
5. UI:
   - Checkbox "Psychoacoustic masking" with a visible "Legacy uniform quantizer" label when off.
   - Reference SPL number input `80..100`.
   - Per-band chart of threshold and SMR when `meta.mdctBands` is present.
   - Readouts: entropy bits, side-info bits, total bitrate, masked share.
   - Theory note: stationary model, no temporal masking, teaching approximation.
6. Tests:
   - Round-trip URL: `pm=1`, `pm=0`, absent.
   - Invalid `rspl` falls back to 94.
   - Stale flags change when either mode field changes.
   - View test: legacy label appears when off; band chart renders when meta bands exist.
7. Run `pnpm --filter @avalab/web exec vitest run src/features/codecLab/codecLabState.test.ts`.

## Task 6 — F13 tool route and view

**Files:** new `features/psychoacoustics/*`, routes, sidebar, i18n, theory

1. Add `"psychoacoustics"` to `TOOL_IDS`; add route `/tools/psychoacoustics`; add sidebar link.
2. State:
   - `referenceSplDb: 80..100`, default 94.
   - `frequencyScale: "linear" | "log"`, default log.
   - `showThreshold: boolean`, default true.
   - URL keys: `rspl`, `fs`, `th`.
   - Total decode with fallbacks.
3. View:
   - No audio: call `psychoacousticCurves`, draw ATH and spreading heatmap/curve.
   - With audio: call `psychoacousticAnalysis` on the current selection (or first 30 s), draw source band levels + threshold overlay.
   - Controls for reference SPL, scale, threshold visibility.
   - Link button to `/tools/codec-lab?c=mdct&pm=1&rspl=<value>`.
   - Theory panel with ATH, critical bands, simultaneous masking, SMR, and why codecs discard masked content.
4. i18n keys under `tool.psychoacoustics`, `psychoacoustics.*`, `nav.psychoacoustics` in both locales. Persian text flagged for review.
5. Tests:
   - State URL round-trip and clamping.
   - Static render: no-audio shows ATH chart shell and theory; audio state shows band controls.
6. Run `pnpm --filter @avalab/web exec vitest run src/features/psychoacoustics`.

## Task 7 — Documentation and acceptance

1. Add F13 formulas, calibration, side-info convention, complexity, and limitations to `docs/ALGORITHMS.md`.
2. Add the F13 decision to `docs/DECISIONS.md`.
3. Playwright `psychoacoustics.spec.ts`:
   - Open `/tools/psychoacoustics` in `en` and `fa`.
   - Assert no console errors.
   - Load demo clip; threshold overlay appears.
   - Navigate to codec lab link; run psycho MDCT; masked share and total bitrate are visible.
4. Run `pnpm check`, `pnpm --filter @avalab/web e2e -- psychoacoustics.spec.ts`, `pnpm gen:golden`.
5. Update `docs/PROGRESS.md`; do not commit.
