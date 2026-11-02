# Wave 5 · Plan 03 — Separation, ASR, neural codec

**Status:** pending.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish F14: htdemucs source separation, Whisper tiny ASR with WER on the bundled speech clip, and Encodec neural-codec A/B with a rate–distortion point. Each tool runs through the Plan 01 job platform.

**Architecture:** `ml/separation.py`, `ml/asr.py`, `ml/neural_codec.py` are `ModelRunner` implementations. Separation returns four stored stem audio ids; ASR returns text + segments; Encodec returns decoded audio + estimated stream size. The neural-codec tab adds its point to a small rate–distortion chart using the existing F04 chart vocabulary.

**Tech Stack:** `demucs` 4.1.0, `transformers` Whisper tiny, `facebook/encodec_48khz`, torch; React, uPlot.

**Spec:** `AGENTS.md` F04, F05, F14, §8; `docs/plans/wave-5/README.md` D-036.

## Global Constraints

- 30 s excerpt cap; htdemucs is slow, so show honest ETA.
- Source is mono; htdemucs gets a duplicated stereo input.
- Model output rates: htdemucs 44.1 kHz, Whisper 16 kHz input, Encodec 48 kHz. Resample explicitly.
- WER is computed against a reference transcript; only the bundled demo ships one.
- Encodec size is an estimate because Transformers does not expose the real bitstream; label it.
- Real-model tests gated by `AVALAB_RUN_ML_TESTS=1`.

## Review Focus

1. **Stem honesty** — four stems always returned in order `drums, bass, other, vocals`; a failed stem does not silently disappear.
2. **Mono/stereo** — mono source duplicated to stereo; output downmixed back; no channel swap.
3. **ASR inputs** — 16 kHz resample, 30 s cap, empty/silent input returns a structured error, not an empty transcript presented as success.
4. **WER** — case/punctuation normalization is documented; insertions/deletions counted; no divide-by-zero on empty reference.
5. **Neural codec size** — estimated size and bitrate are labeled; decoded audio length aligned to the source.

---

### Task 1: htdemucs separation adapter

**Files:**
- Create: `apps/api/src/avalab_api/ml/separation.py`
- Create: `apps/api/tests/test_ml_separation.py`
- Modify: `apps/api/src/avalab_api/ml/registry.py`

**Interfaces:**
- `SeparationParams(BaseModel): pass`.
- `SeparationRunner(ModelRunner)`:
  - loads htdemucs from the pinned local cache;
  - duplicates mono to stereo, resamples to 44.1 kHz;
  - returns `MlResult(kind="stems", stems=[{name, samples, sample_rate_hz}])`;
  - stems ordered `drums, bass, other, vocals`.
- The job manager persists each stem via `write_result_wav`; the done event carries `stems: [{name, result_audio_id, sample_rate_hz}]` in the fixed order.

- [x] **Step 1: Write `test_ml_separation.py`** with a fake separator: four stems, order, stereo duplication, rate restoration, length preservation; a stem failure raises `ml_failed`; real-model test marked `ml`.
- [x] **Step 2: Run** focused tests — expected FAIL.
- [x] **Step 3: Implement the adapter** with lazy `demucs` import and local weight resolution.
- [x] **Step 4: Run** focused tests, `ruff`, `mypy` — expected PASS.
- [x] **Step 5: Commit** `feat(F14): add htdemucs separation adapter`.

### Task 2: Separation UI

**Files:**
- Create: `apps/web/src/features/ai/separationTab.tsx`
- Create: `apps/web/src/features/ai/separationTab.test.tsx`
- Modify: `apps/web/src/features/ai/aiLabView.tsx`
- Modify: `apps/web/src/i18n/en.json`
- Modify: `apps/web/src/i18n/fa.json`

**Interfaces:**
- Uses `music-life-turns-15s.wav` by default; “Separate” runs with a 15 s excerpt.
- Four stem rows with play buttons; selecting a stem fetches `GET /audio/{stem.result_audio_id}` and calls `setProcessed`.
- Shows “CPU may take several minutes” ETA note and model id.

- [x] **Step 1: Write component tests** for four stems, play sets processed source, error row, disabled model, cancel.
- [x] **Step 2: Run** focused tests — expected FAIL.
- [x] **Step 3: Implement the tab + `ai.separation.*` keys.**
- [x] **Step 4: Run** `pnpm check` — expected PASS.
- [x] **Step 5: Commit** `feat(F14): add stem separation tab`.

### Task 3: Whisper ASR adapter and WER util

**Files:**
- Create: `apps/api/src/avalab_api/ml/asr.py`
- Create: `apps/api/tests/test_ml_asr.py`
- Create: `apps/web/src/features/ai/wer.ts`
- Create: `apps/web/src/features/ai/wer.test.ts`
- Modify: `apps/api/src/avalab_api/ml/registry.py`

**Interfaces:**
- `AsrParams(BaseModel): language: str | None = None`.
- `AsrRunner(ModelRunner)` resamples to 16 kHz, runs Whisper tiny, returns `MlResult(kind="transcript", text, segments=[{start_s, end_s, text}], language)`.
- `wordErrorRate(reference: string, hypothesis: string): number` normalizes case/punctuation/whitespace, returns `(S+D+I)/N`, and throws `RangeError` only for an empty reference.
- `normalizeTranscript(text: string): string` exported for tests.

- [x] **Step 1: Write backend tests** with a fake pipeline: text/segments, 16 kHz resample, empty audio error, real-model test `ml`.
- [x] **Step 2: Write `wer.test.ts`** with exact match, one substitution, insertion, deletion, punctuation/case, empty reference.
- [x] **Step 3: Run** `uv run --directory apps/api pytest -q tests/test_ml_asr.py` and `pnpm --filter @avalab/web exec vitest run src/features/ai/wer` — expected FAIL.
- [x] **Step 4: Implement both**, with lazy `transformers` import and a documented WER normalization rule.
- [x] **Step 5: Run** focused tests, `ruff`, `mypy` — expected PASS.
- [x] **Step 6: Commit** `feat(F14): add Whisper ASR and WER`.

### Task 4: ASR UI with reference transcript

**Files:**
- Create: `apps/web/src/features/ai/asrTab.tsx`
- Create: `apps/web/src/features/ai/asrTab.test.tsx`
- Modify: `apps/web/src/features/ai/aiLabView.tsx`
- Modify: `apps/web/src/i18n/en.json`
- Modify: `apps/web/src/i18n/fa.json`

**Interfaces:**
- Default demo `speech`; reference text is fetched from `/demo/speech-kathleen-19s.txt`.
- Run ASR; render transcript and segments; if reference present, show WER and a warning for empty reference.
- “Use compressed input” hint links to the codec lab for E3; no automatic multi-codec batch in this task.

- [x] **Step 1: Write component tests** for transcript, segments, reference fetch, WER, missing reference, disabled model.
- [x] **Step 2: Run** focused tests — expected FAIL.
- [x] **Step 3: Implement the tab + `ai.asr.*` keys.**
- [x] **Step 4: Run** `pnpm check` — expected PASS.
- [x] **Step 5: Commit** `feat(F14): add ASR transcript and WER tab`.

### Task 5: Encodec neural-codec adapter

**Files:**
- Create: `apps/api/src/avalab_api/ml/neural_codec.py`
- Create: `apps/api/tests/test_ml_neural_codec.py`
- Modify: `apps/api/src/avalab_api/ml/registry.py`

**Interfaces:**
- `NeuralCodecParams(BaseModel): bandwidth_kbps: Literal[1.5, 3, 6, 12, 24] = 6`.
- `NeuralCodecRunner(ModelRunner)`:
  - mono input, resample to 48 kHz;
  - `EncodecModel.from_pretrained` + `EncodecProcessor`;
  - decode with the requested bandwidth;
  - trim/pad to source length, resample to source rate;
  - stats `{bandwidth_kbps, estimated_size_bytes, estimated_bitrate_kbps, duration_s}`.
- Estimated size = `bandwidth_kbps * 1000 / 8 * duration_s`; label `estimated`.

- [ ] **Step 1: Write tests** with a fake encodec seam: bandwidth validation, estimate formula, length/rate restoration, silent input, real-model test `ml`.
- [ ] **Step 2: Run** focused tests — expected FAIL.
- [ ] **Step 3: Implement the adapter** with lazy `transformers`/torch imports.
- [ ] **Step 4: Run** focused tests, `ruff`, `mypy` — expected PASS.
- [ ] **Step 5: Commit** `feat(F14): add Encodec neural-codec adapter`.

### Task 6: Neural-codec UI and rate–distortion point

**Files:**
- Create: `apps/web/src/features/ai/neuralCodecTab.tsx`
- Create: `apps/web/src/features/ai/neuralCodecTab.test.tsx`
- Modify: `apps/web/src/features/codecLab/rateDistortionChart.tsx`
- Modify: `apps/web/src/features/ai/aiLabView.tsx`
- Modify: `apps/web/src/i18n/en.json`
- Modify: `apps/web/src/i18n/fa.json`

**Interfaces:**
- Bandwidth selector; run; A/B original/decoded; stats table.
- `RateDistortionChart` gains optional `extraPoints?: { labelKey: string; bitrateKbps: number; snrDb: number }[]`; existing callers unchanged.
- AI tab renders one neural point plus any rows the user already produced in the codec comparison; no automatic codec batch.
- Honest labels: “estimated bitrate” and “AI codec approximation”.

- [ ] **Step 1: Write chart tests** for extra points and finite filtering; component tests for bandwidth/run/A-B/estimate labels.
- [ ] **Step 2: Run** focused tests — expected FAIL.
- [ ] **Step 3: Implement the tab and chart extension.**
- [ ] **Step 4: Run** `pnpm check` — expected PASS.
- [ ] **Step 5: Commit** `feat(F14): add neural codec A/B and rate point`.

### Task 7: Docs and gated smoke

**Files:**
- Modify: `docs/MODELS.md`
- Modify: `docs/ALGORITHMS.md`
- Modify: `docs/PROGRESS.md`

- [ ] **Step 1: Record htdemucs/Whisper/Encodec rates, licenses, limits, and WER normalization.**
- [ ] **Step 2: Run** gated real-model tests if models are present; otherwise record skips.
- [ ] **Step 3: Commit** `docs(F14): record separation, ASR and neural codec behavior`.

## Completion Gate

- All three tabs work on CPU with progress/cancel.
- Four stems, transcript/WER, and decoded audio are usable.
- Missing model/offline states are disabled, not crashing.
- Neural point appears on the existing rate–distortion chart.
- Real-model smoke recorded.
