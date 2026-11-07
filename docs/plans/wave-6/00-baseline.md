# Wave 6 Plan 00 — Baseline Fixes and Gap Audit

## Metadata

- Spec: [`design.md`](design.md) §5, §12, §15
- Depends on: none
- Unblocks: plans 01–07
- Scope: F01–F18 baseline correctness, worker boundary cleanup, feature audit
- Out of scope: new tools; F05 perceptual metric; model changes; commits

## Global constraints

- Do not commit. This session forbids commits unless the owner explicitly asks.
- DSP math stays in the worker. No main-thread sample loops in views.
- Every changed behavior gets one regression test that fails before the fix.
- Both `en` and `fa` stay complete; no new hard-coded visible strings.
- API changes require `pnpm gen:api`, pytest, ruff, and mypy.
- Leave the repo green after every task checkpoint.

## Review focus

1. **Correctness:** each test fails on the pre-fix code for the right reason.
2. **Source identity:** stale AI results cannot install after source changes.
3. **Time math:** excerpt offsets preserve absolute playhead position in A/B.
4. **Boundary honesty:** `GET /models` and denoise A/B never overstate capability.
5. **Worker purity:** no new `@avalab/dsp` import in a React view or store.

## File map

Create:
- `docs/plans/wave-6/audit.md`
- `apps/web/src/features/fftview/fftState.test.ts`
- `apps/web/src/features/ai/sseStream.test.ts` (extract parser helper)
- `apps/web/src/session/ops.qualityMetrics.test.ts`
- `apps/web/src/session/ops.waveformEnvelope.test.ts`
- `apps/web/src/features/codecLab/comparison.realRow.worker.test.ts`
- `apps/web/e2e/player.spec.ts` (extend with playback timer smoke)

Modify:
- `apps/web/src/features/fftview/fftView.tsx`
- `apps/web/src/features/fftview/fftState.ts`
- `apps/web/src/session/store.ts`
- `apps/web/src/session/store.test.ts`
- `apps/web/src/features/player/transport.ts`
- `apps/web/src/features/player/transport.test.ts`
- `apps/web/src/features/player/usePlayer.ts`
- `apps/web/src/features/ai/aiClient.ts`
- `apps/web/src/features/ai/aiClient.test.ts`
- `apps/web/src/features/ai/asrTab.tsx`
- `apps/web/src/features/ai/asrTab.test.tsx`
- `apps/web/src/features/ai/denoiseTab.tsx`
- `apps/web/src/features/ai/denoiseTab.test.tsx`
- `apps/web/src/features/ai/separationTab.tsx`
- `apps/web/src/features/ai/separationTab.test.tsx`
- `apps/web/src/features/ai/superresTab.tsx`
- `apps/web/src/features/ai/superresTab.test.tsx`
- `apps/web/src/features/ai/neuralCodecTab.tsx`
- `apps/web/src/features/ai/neuralCodecTab.test.tsx`
- `apps/web/src/features/codecLab/comparison.ts`
- `apps/web/src/features/codecLab/comparisonRunner.ts`
- `apps/web/src/features/codecLab/codecLabView.tsx`
- `apps/web/src/features/metrics/metricsView.tsx`
- `apps/web/src/features/extent/extentView.tsx`
- `apps/web/src/features/reverb/reverbView.tsx`
- `apps/web/src/session/ops.ts`
- `apps/web/src/workers/dsp.worker.ts`
- `apps/web/src/i18n/en.json`
- `apps/web/src/i18n/fa.json`
- `apps/api/src/avalab_api/routes/models.py`
- `apps/api/tests/test_ml_routes.py`
- `apps/web/src/api/schema.d.ts` (generated)
- `apps/web/src/features/ai/aiLabView.tsx`
- `apps/web/src/features/ai/aiState.ts`

## Task 1 — Fix the FFT phase mask unit bug

**Files:** `fftState.ts`, `fftView.tsx`, `fftState.test.ts`

1. Add `phaseMaskBins(magnitude: Float64Array, phase: Float64Array, magnitudeMode: "db" | "linear", thresholdDb: number): (number | null)[]` to `fftState.ts`. It converts only linear magnitude to dB and returns `null` below the threshold.
2. Write failing tests:
   - `db` input `[-40, -10]` with threshold `-20` returns `[null, phase[1]]`.
   - `linear` input `[0.01, 0.5]` with threshold `-20` returns `[null, phase[1]]` (`0.01` is `-40 dB`).
   - zero magnitude returns `null`, never `-Infinity` comparisons.
3. Run: `pnpm --filter @avalab/web exec vitest run src/features/fftview/fftState.test.ts`.
   Expected before implementation: the new export is missing.
4. Replace the inline loop in `fftView.tsx` with `phaseMaskBins(...)`. Use `settings.magnitudeMode` and `settings.phaseMaskDb`.
5. Run the same test; expect pass. Run `pnpm --filter @avalab/web exec vitest run src/features/fftview`.
6. Checkpoint: phase chart shows values for bins above the threshold in both magnitude modes.

## Task 2 — Key AI results to source identity and preserve excerpt offset

**Files:** `store.ts`, `store.test.ts`, `transport.ts`, `transport.test.ts`, `usePlayer.ts`, AI tabs

1. Extend `ProcessedSource`:
   - `readonly sourceStartSample: number` (0 for whole-source results)
   - `readonly sourceHash: string | null` (null for non-AI tools)
2. Extend `setProcessed` options:
   ```ts
   type SetProcessedOptions = {
     readonly sourceHash?: string;
     readonly sourceStartSample?: number;
   };
   ```
   Add `sourceHash?: string` and `sourceStartSample?: number` to the signature after `label`.
3. Add rejection code `staleSource`. If `sourceHash` is provided and does not equal current `inputHash`, return `{ ok: false, code: "staleSource" }` without changing state. Add `processed.error.staleSource` in both locales.
4. Validate `sourceStartSample`: finite, integer, `>= 0`, `<= original.samples.length`; reject as `invalidType` otherwise.
5. Store the normalized values on `processed`.
6. Add `mapAbsolutePlayheadToLane(absoluteSeconds, laneStartSample, targetRateHz, targetLengthSamples)` to `transport.ts`:
   ```ts
   const localSeconds = absoluteSeconds - laneStartSample / targetRateHz;
   return mapPlayheadSeconds(Math.max(0, localSeconds), targetRateHz, targetLengthSamples);
   ```
7. Update `usePlayer` source-swap effect. Before swap, compute `absoluteSeconds = active.sourceStartSample / active.sampleRateHz + machine.currentSample / machine.sampleRateHz`. After `setSource`, seek with `mapAbsolutePlayheadToLane(absoluteSeconds, next.sourceStartSample, ...)`.
8. Tests:
   - `store.test.ts`: correct hash accepts; stale hash rejects with `staleSource`; invalid offsets reject; defaults are `sourceHash: null`, `sourceStartSample: 0`.
   - `transport.test.ts`: original at 2.0 s → excerpt at 10 s maps to local 0; excerpt local 2 s (absolute 12 s) → original maps to 12 s; negative local clamps to 0.
   - Each AI tab test: install uses `{ sourceHash: store.inputHash, sourceStartSample: excerpt.startSample }`.
9. Update all AI install paths to capture `sourceHash` at job start and pass it. For tabs that slice from 0, `sourceStartSample` is 0; keep the field so later excerpt selectors cannot regress.
10. Run `pnpm --filter @avalab/web exec vitest run src/session/store.test.ts src/features/player/transport.test.ts src/features/ai`.
    Expect pass.

## Task 3 — Match the ASR reference by demo identity

**Files:** `asrTab.tsx`, `asrTab.test.tsx`

1. Replace `usesReferenceTranscript(sourceName: string | undefined)` with:
   ```ts
   export function usesReferenceTranscript(
     source: Pick<SessionSource, "sourceKind" | "demoId"> | null,
   ): boolean {
     return source?.sourceKind === "demoClip" && source.demoId === "speech";
   }
   ```
2. Update the effect dependency to `original` and pass `original` directly.
3. Tests:
   - Demo `speech` returns true.
   - Demo `speechNoisy` returns false.
   - An uploaded file named `speech-kathleen-19s.wav` returns false.
   - The view sets `referenceStatus="loading"` only for the demo.
4. Run: `pnpm --filter @avalab/web exec vitest run src/features/ai/asrTab.test.tsx`.

## Task 4 — Report `ml_enabled` honestly

**Files:** `apps/api/src/avalab_api/routes/models.py`, `apps/api/tests/test_ml_routes.py`, `aiClient.ts`, `aiClient.test.ts`, `aiLabView.tsx`, generated schema

1. Add top-level `ml_enabled: bool` to `ModelsResponse`. Populate from `settings.ml_enabled`.
2. Keep model rows unchanged, but the frontend must not show "available" as usable when `ml_enabled` is false. Add `mlEnabled` to `AiModelsResponse`.
3. `AiLabView`: when `mlEnabled === false`, render `ai.models.disabled` and disable every model-backed run. Analysis tasks in plan 04 are not model-backed.
4. Add `ai.models.disabled` to both locales.
5. API test: settings override `ml_enabled=False` returns `ml_enabled: false`; `POST /ml/denoise` still returns 503.
6. Frontend test: disabled response disables `ai.run`.
7. Run `pnpm gen:api`, `uv run --directory apps/api pytest tests/test_ml_routes.py -q`, `pnpm --filter @avalab/web exec vitest run src/features/ai/aiClient.test.ts`.

## Task 5 — Guard denoise A/B to the denoise lane

**Files:** `denoiseTab.tsx`, `denoiseTab.test.tsx`

1. Derive `const hasDenoiseLane = processed?.label === "denoise";`.
2. Use `hasDenoiseLane` for the "denoised" button disabled state and pressed state. `onPlayDenoised` stays a no-op when false.
3. Test: with a processed lane labeled `superres-restored`, the denoised button is disabled and not pressed; with `denoise`, enabled.
4. Run: `pnpm --filter @avalab/web exec vitest run src/features/ai/denoiseTab.test.tsx`.

## Task 6 — Normalize CRLF across SSE chunk boundaries

**Files:** `aiClient.ts`, new `sseStream.test.ts`

1. Extract `parseSseChunks(chunks: AsyncIterable<Uint8Array>, onEvent)` into `sseStream.ts` with no network dependency.
2. Append decoded text, then normalize the whole buffer with `.replace(/\r\n/g, "\n")` before searching for `\n\n`. Do not normalize only the newly decoded chunk.
3. At stream end, normalize the remaining buffer before parsing.
4. Tests:
   - Chunks split as `"data: {...}\r"` + `"\n\r\n"` emit one event.
   - Lone `\r` inside JSON is preserved.
   - Multi-event chunks parse in order.
5. Run: `pnpm --filter @avalab/web exec vitest run src/features/ai/sseStream.test.ts src/features/ai/aiClient.test.ts`.

## Task 7 — Move remaining main-thread audio math to worker ops

**Files:** `ops.ts`, `dsp.worker.ts`, `ops.waveformEnvelope.test.ts`, `ops.qualityMetrics.test.ts`, `extentView.tsx`, `reverbView.tsx`, `metricsView.tsx`, `comparison.ts`, `comparisonRunner.ts`, `codecLabView.tsx`

1. Add `waveformEnvelope` op:
   - Params: `{ bucketCount: number }`.
   - Payload: mono Float32 samples.
   - Result: `{ meta: { bucketCount } ; payload: Float32Array min/max pairs }`.
   - Handler computes buckets with one pass; empty input returns one zero pair.
2. Replace local `peakBuckets` in `extentView.tsx` and `reverbView.tsx` with `deriveStandalone("waveformEnvelope", { bucketCount }, payload)`. Keep paint code; delete the local loops.
3. Add `qualityMetrics` op:
   - Params: `{ sampleRateHz: number; sampleCount: number }`.
   - Payload: `reference ++ test` Float32 lanes in one buffer.
   - Result: `{ mse, snrDb, segmentalSnrDb, psnrDb }` using `@avalab/dsp` metrics; validate equal lengths and finite values.
4. `metricsView.tsx`: use `deriveStandalone` with a combined copy; render pending as `metrics.pending`, then metrics or a typed mismatch.
5. `comparison.ts`: change `realRow(run, codec, labelKey, metrics: QualityMetrics | null)` to accept precomputed metrics; remove `computeQualityMetrics` import.
6. `comparisonRunner.ts`: add `measureQuality` runner callback; await it for real rows.
7. `codecLabView.tsx`: for the single real result, measure metrics in an effect and pass them to `realRow`.
8. Tests:
   - `waveformEnvelope`: 8 samples, 4 buckets, expected min/max; empty input.
   - `qualityMetrics`: identical signals, known SNR for a scaled signal, length mismatch rejects.
   - `comparison.realRow.worker.test.ts`: metrics are attached, no `@avalab/dsp` import in comparison.
9. Run `pnpm --filter @avalab/web exec vitest run src/session/ops.waveformEnvelope.test.ts src/session/ops.qualityMetrics.test.ts src/features/codecLab/comparison.realRow.worker.test.ts`.
10. Run `pnpm check`.

## Task 8 — Write the feature gap audit

**Files:** `docs/plans/wave-6/audit.md`

1. Create a table with one row per F01–F18 bullet from `AGENTS.md` §4. Columns: feature bullet, status (`implemented`, `partial`, `missing`, `out of scope`), evidence files, evidence tests, missing work.
2. Mark F05 perceptual metric `out of scope` with `D-005`.
3. Mark any partial item that plan 04 must own. Plan 04 must not add a feature absent from this audit.
4. Include a "no silent drops" checklist: every `partial`/`missing` row maps to a plan 04 task or an owner decision.
5. Run: `rg -n "F0[1-9]|F1[0-8]" docs/plans/wave-6/audit.md` and confirm all 18 families appear.

## Task 9 — Fix the missing playback connection

**Files:** `transport.ts`, `transport.test.ts`

1. Add `connect(destination: unknown): void` to `TransportNode`.
2. In `startPlayback`, call `node.connect(context.destination)` before `node.start(...)`.
3. Extend the transport fakes to record `connect`; test that every started node connects to the destination exactly once, and a restarted node connects again.
4. Add a Playwright playback smoke: load a demo clip, press play, assert the timer advances (audio output itself is not observable in headless Chromium).
5. Run `pnpm --filter @avalab/web exec vitest run src/features/player/transport.test.ts`.

## Task 10 — Baseline verification

1. Run `pnpm check`.
2. Run `pnpm e2e` with Chromium.
3. Run `uv run --directory apps/api pytest -q`, `uv run --directory apps/api ruff check .`, `uv run --directory apps/api mypy .` if the API changed.
4. Run `pnpm --filter @avalab/web build`.
5. Update `docs/PROGRESS.md` with fixes, test commands, and any residual risks.
6. Do not commit.
