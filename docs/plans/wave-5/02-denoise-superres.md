# Wave 5 · Plan 02 — Denoise and super-resolution

**Status:** complete — Tasks 1–6 done; real-model smoke recorded in `docs/PROGRESS.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two working F14 tools on the Plan 01 platform: DPDFNet speech denoising and LavaSR bandwidth extension, each with a real wrapper, A/B UI, and a sinc baseline for the super-resolution experiment.

**Architecture:** `ml/denoise.py` and `ml/superres.py` implement `ModelRunner` behind the registry. Both resample to the model rate and back to the source rate, trim/pad to length, and store one canonical result. The AI super-resolution tab adds a browser-side sinc path using the existing `resampleRational` DSP op, so the experiment compares learned vs classical upsampling on the same band-limited input.

**Tech Stack:** `sherpa-onnx` 2.0.1, `audiosronnx` 0.0.1 + ONNX Runtime, NumPy, SciPy; React, Zustand, existing DSP worker.

**Spec:** `AGENTS.md` F03, F14, §8; `docs/plans/wave-5/README.md` D-032, D-037.

## Global Constraints

- 30 s excerpt cap; no full-file ML.
- Model outputs are approximations; show the honest caption.
- Resample explicitly; never assume source rate equals model rate.
- Missing/corrupt model → `model_unavailable`, never a crash.
- Real-model tests gated by `AVALAB_RUN_ML_TESTS=1`.
- All strings through i18n; technical readouts LTR.

## Review Focus

1. **Rate contract** — source 8/16/22.05/44.1/48/96 kHz → model rate → source rate; output length equals input length ± tolerance.
2. **Short/silent input** — <0.2 s or all-zero input returns a safe result or structured error; no divide-by-zero or NaN.
3. **LavaSR input assumptions** — record the exact expected input rate from the model/package; do not feed 48 kHz blindly if it expects 16 kHz.
4. **A/B alignment** — original, band-limited, restored signals share the same start sample and length; no audible offset.
5. **Sinc baseline** — baseline uses the same band-limited input as LavaSR; no hidden resampling difference.

---

### Task 1: DPDFNet denoise adapter

**Files:**
- Create: `apps/api/src/avalab_api/ml/denoise.py`
- Create: `apps/api/tests/test_ml_denoise.py`
- Modify: `apps/api/src/avalab_api/ml/registry.py`

**Interfaces:**
- `DenoiseParams(BaseModel): pass` (reserved).
- `DenoiseRunner(ModelRunner)`:
  - `run(samples: np.ndarray, sample_rate_hz: int, params: dict[str, object], progress: Callable[[float], None]) -> MlResult`
  - resamples to 48 kHz, calls `sherpa_onnx` DPDFNet denoiser, resamples back, trims/pads to input length.
- `MlResult`: `{kind: "audio", samples, sample_rate_hz, stats: {"model_id": str, "duration_s": float, "rms_in_db": float, "rms_out_db": float}}`.
- Registry loader `load_dpdfnet(cache_dir) -> DenoiseRunner`.

- [x] **Step 1: Write `test_ml_denoise.py`** with a fake sherpa seam: asserts 48 kHz in/out, source-rate restoration, length preservation, finite output, silent input stable; real-model test marked `@pytest.mark.ml`.
- [x] **Step 2: Run** `uv run --directory apps/api pytest -q tests/test_ml_denoise.py` — expected FAIL.
- [x] **Step 3: Implement the adapter** with lazy `sherpa_onnx` import and a documented fallback error when the package is absent.
- [x] **Step 4: Run** focused tests, `ruff`, `mypy` — expected PASS.
- [x] **Step 5: Commit** `feat(F14): add DPDFNet denoise adapter`.

### Task 2: Denoise UI

**Files:**
- Create: `apps/web/src/features/ai/denoiseTab.tsx`
- Create: `apps/web/src/features/ai/denoiseTab.test.tsx`
- Modify: `apps/web/src/features/ai/aiLabView.tsx`
- Modify: `apps/web/src/i18n/en.json`
- Modify: `apps/web/src/i18n/fa.json`

**Interfaces:**
- Tab loads `speech-kathleen-noisy-5db-19s.wav` via `loadDemoClip("speechNoisy")`.
- “Denoise” runs `useAiJob("denoise")`; the done event returns `result_audio_id`, fetched via `GET /audio/{result_audio_id}` and installed with `setProcessed`.
- A/B buttons: original, noisy, denoised; RMS readout; model id caption.

- [x] **Step 1: Write component tests** with fake job/store/audio seams: disabled without model, run starts upload, progress renders, done installs processed source, cancel clears running state.
- [x] **Step 2: Run** `pnpm --filter @avalab/web exec vitest run src/features/ai/denoiseTab` — expected FAIL.
- [x] **Step 3: Implement the tab + i18n keys** `ai.denoise.*`, `ai.caption.approximation`.
- [x] **Step 4: Run** `pnpm check` — expected PASS.
- [x] **Step 5: Commit** `feat(F14): add denoise A/B tab`.

### Task 3: LavaSR super-resolution adapter

**Files:**
- Create: `apps/api/src/avalab_api/ml/superres.py`
- Create: `apps/api/tests/test_ml_superres.py`
- Modify: `apps/api/src/avalab_api/ml/registry.py`

**Interfaces:**
- `SuperresParams(BaseModel): pass`.
- `SuperresRunner(ModelRunner)`:
  - Loads LavaSR via `audiosronnx` from a local pinned model path.
  - Exposes `input_sample_rate_hz` and `output_sample_rate_hz` after load.
  - Resamples input to model input rate, runs, resamples to source rate, trims/pads.
- Real-model test verifies non-finite absence and that output high-band energy increases on a band-limited speech fixture.

- [x] **Step 1: Write `test_ml_superres.py`** with a fake enhancer seam: rate restoration, length preservation, silence, short input; a unit test reads and records `input_sample_rate_hz`/`output_sample_rate_hz`; real-model test marked `ml`.
- [x] **Step 2: Run** focused tests — expected FAIL.
- [x] **Step 3: Implement the adapter**; if `audiosronnx` only exposes `load_sr`, wrap it and document the pinned local path.
- [x] **Step 4: Run** focused tests, `ruff`, `mypy` — expected PASS.
- [x] **Step 5: Commit** `feat(F14): add LavaSR super-resolution adapter`.

### Task 4: Sinc baseline worker op

**Files:**
- Modify: `apps/web/src/session/ops.ts`
- Create: `apps/web/src/session/ops.superresBaseline.test.ts`
- Modify: `apps/web/src/session/ops.test.ts` (op table count only if necessary)

**Interfaces:**
- `superresBaseline` params: `{ sampleRateHz: number; targetRateHz: number }`; input samples ride the existing payload lane.
- Result: `{ samples: Float32Array; sampleRateHz: number; delaySamples: number }`.
- Implementation converts the payload to `Float64Array`, calls `resampleRational(..., { filter: "kaiserSinc" })`, and returns a `Float32Array`; no new dependency.

- [x] **Step 1: Write the failing op test** with a 1 kHz sine at 8 kHz → 48 kHz; assert length ratio, finite samples, peak near 1 kHz, and no aliasing image.
- [x] **Step 2: Run** `pnpm --filter @avalab/web exec vitest run src/session/ops.superresBaseline` — expected FAIL.
- [x] **Step 3: Implement the op** and export its types.
- [x] **Step 4: Run** `pnpm check` — expected PASS.
- [x] **Step 5: Commit** `feat(F14): add sinc super-resolution baseline op`.

### Task 5: Super-resolution UI and experiment link

**Files:**
- Create: `apps/web/src/features/ai/superresTab.tsx`
- Create: `apps/web/src/features/ai/superresTab.test.tsx`
- Modify: `apps/web/src/features/ai/aiLabView.tsx`
- Modify: `apps/web/src/i18n/en.json`
- Modify: `apps/web/src/i18n/fa.json`

**Interfaces:**
- Controls: downsample to 8/12/16 kHz (anti-alias on), restore with `sinc` or `lavasr`, A/B original/band-limited/restored.
- Uses `speech-kathleen-19s.wav`; original is the reference, band-limited is derived in the worker, restored comes from the selected path.
- Shows model rate, output rate, and “AI approximation” caption for LavaSR.

- [x] **Step 1: Write component tests** for downsample validation, sinc/LavaSR branch selection, disabled model state, and A/B labels.
- [x] **Step 2: Run** focused tests — expected FAIL.
- [x] **Step 3: Implement the tab + `ai.superres.*` keys.**
- [x] **Step 4: Add a link target** `?task=superres&demo=speech` for the F16 experiment (route wiring lands in Plan 05).
- [x] **Step 5: Run** `pnpm check` — expected PASS.
- [x] **Step 6: Commit** `feat(F14): add super-resolution A/B tab`.

### Task 6: Docs and gated smoke

**Files:**
- Modify: `docs/MODELS.md`
- Modify: `docs/ALGORITHMS.md`
- Modify: `docs/PROGRESS.md`

- [x] **Step 1: Record DPDFNet and LavaSR input/output rates, licenses, and limitations.**
- [x] **Step 2: Document the sinc baseline formula and the comparison protocol.**
- [x] **Step 3: Run** `AVALAB_RUN_ML_TESTS=1 uv run --directory apps/api pytest -q -m ml` if models are present; otherwise record the skip.
- [x] **Step 4: Commit** `docs(F14): record denoise and super-resolution behavior`.

## Completion Gate

- Both tabs work with real models on CPU and show progress.
- Missing model and offline backend are disabled states, not errors.
- Output length/rate contract tested for 8–96 kHz inputs.
- Sinc and LavaSR use the same band-limited input.
- Real-model smoke recorded in `PROGRESS.md`.
