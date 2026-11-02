# Wave 5 · Plan 01 — ML platform, assets, job manager, AI shell

**Status:** pending.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working F14 platform: pinned model registry, optional ML dependency set, bounded in-process jobs with SSE, one AI route with five tabs, and CC0 speech/music demo assets. No model-specific inference yet.

**Architecture:** Backend `avalab_api/ml/` owns model specs, lazy loaders, job scheduling, and result storage. `routes/ml.py` exposes `GET /models`, `POST /ml/{task}`, `GET /jobs/{id}/events`, `DELETE /jobs/{id}`. Frontend `features/ai/` owns the route shell, API client, SSE parser, and job hook. Model-specific wrappers arrive in Plans 02–03.

**Tech Stack:** FastAPI, Pydantic, `ThreadPoolExecutor`, SSE (`StreamingResponse`); React 19, React Router, Zustand, openapi-fetch, uPlot not used here.

**Spec:** `AGENTS.md` F14, §7, §8, §9; `docs/plans/wave-5/README.md` D-032–D-036.

## Global Constraints

- CPU floor; max concurrency 1; no Redis/Celery.
- 30 s ML excerpt cap enforced by backend (`D-035`).
- Model weights never downloaded at request time; no weights committed.
- ML dependencies optional (`D-033`); default test suite must run without torch.
- SSE events must be typed and stable: `progress`, `done`, `error`, `cancelled`.
- All strings through i18n; charts/technical readouts LTR.
- No main-thread DSP; no new JS dependency for SSE.

## Review Focus

1. **Missing model/cache** — `/models` reports `missing`; AI tabs disable with a reason; no import of torch/sherpa.
2. **Job lifecycle** — cancel stops the runner between chunks; route change/SSE disconnect leaves no orphan job; TTL removes results and audio.
3. **Excerpt cap** — >30 s input rejects with `invalid_request`; source rate/channels preserved; short/silent input reaches the runner safely.
4. **Offline backend** — AI route still renders; run buttons disabled; zero console errors.
5. **Share-safe state** — only task/tab and future demo ids enter the URL; no upload identity.

---

### Task 1: F14 demo assets and provenance

**Files:**
- Create: `tools/demo_clips/fetch_f14.py`
- Create: `tools/demo_clips/test_f14_assets.py`
- Create: `apps/web/public/demo/speech-kathleen-19s.wav`
- Create: `apps/web/public/demo/speech-kathleen-19s.txt`
- Create: `apps/web/public/demo/speech-kathleen-noisy-5db-19s.wav`
- Create: `apps/web/public/demo/music-life-turns-15s.wav`
- Modify: `docs/THIRD_PARTY.md`

**Interfaces:**
- `fetch_f14.py` exposes `build_assets(out_dir: Path) -> list[Path]` and `--check`.
- Speech: 48 kHz, 16-bit PCM, mono, three concatenated Kathleen utterances with 0.4 s silence between.
- Transcript file has the exact three sentences separated by spaces.
- Noisy derivative: deterministic pink noise at 5 dB SNR (`np.random.default_rng(20261103)`), clipped to [-1, 1], same rate/length.
- Music: 48 kHz, 16-bit PCM, mono, 15 s from a fixed start offset; record the offset in the script.

- [ ] **Step 1: Write `test_f14_assets.py`** with stdlib `unittest`: exact file names, WAV header (48 kHz/16-bit/mono), speech duration 18.5–20.5 s, music 14.5–15.5 s, transcript non-empty, noisy SNR within ±0.5 dB.
- [ ] **Step 2: Run** `uv run --directory tools/demo_clips python -m unittest test_f14_assets -v` — expected FAIL (missing files).
- [ ] **Step 3: Implement `fetch_f14.py`** with fixed source URLs, SHA-256 checks for downloads, `wave` module for output, and `--check` that verifies existing files without downloading.
- [ ] **Step 4: Run** `uv run --directory tools/demo_clips python fetch_f14.py` then the unittest — expected PASS.
- [ ] **Step 5: Update `docs/THIRD_PARTY.md`** with both CC0 sources, revisions/URLs, derived-file provenance, and the exact transcript source.
- [ ] **Step 6: Commit** `feat(F14): add CC0 speech and music demo assets`.

### Task 2: ML config, dependencies, errors

**Files:**
- Modify: `apps/api/pyproject.toml`
- Modify: `apps/api/src/avalab_api/config.py`
- Modify: `apps/api/src/avalab_api/errors.py`
- Create: `apps/api/tests/test_ml_config.py`

**Interfaces:**
- Settings add `ml_enabled: bool = True`, `ml_max_concurrency: int = 1`, `ml_max_excerpt_seconds: int = 30`, `ml_model_cache_dir: Path = Path.home() / ".cache" / "avalab" / "models"`, `ml_device: str = "cpu"`.
- ErrorCode add `model_unavailable`, `job_not_found`, `job_cancelled`, `ml_failed`, `ml_busy`.
- `pyproject.toml` `[project.optional-dependencies] ml = [...]` pins `torch`, `torchaudio`, `transformers`, `demucs`, `sherpa-onnx`, `audiosronnx`, `onnxruntime`, `huggingface-hub`, `soundfile`; `uv.lock` regenerated. Platform markers implement D-039: Intel macOS gets NumPy 1.26/SciPy 1.16/torch 2.2.2, all other platforms keep NumPy 2.5/SciPy 1.18/torch 2.6+. Register the `ml` pytest marker (`markers = ["ml: real model tests, gated by AVALAB_RUN_ML_TESTS=1"]`).

- [ ] **Step 1: Write `test_ml_config.py`** asserting defaults, env overrides (`AVALAB_ML_MAX_EXCERPT_SECONDS=10`), and the new error codes serialize as strings.
- [ ] **Step 2: Run** `uv run --directory apps/api pytest -q tests/test_ml_config.py` — expected FAIL.
- [ ] **Step 3: Implement config/errors and the optional extra**; keep ML imports out of default modules.
- [ ] **Step 4: Run** `uv run --directory apps/api pytest -q tests/test_ml_config.py` and `uv run --directory apps/api ruff check .` — expected PASS.
- [ ] **Step 5: Commit** `feat(F14): add ML settings and optional dependencies`.

### Task 3: Model registry, manifest, download script, `/models`

**Files:**
- Create: `apps/api/src/avalab_api/ml/__init__.py`
- Create: `apps/api/src/avalab_api/ml/models.py`
- Create: `apps/api/src/avalab_api/ml/registry.py`
- Create: `apps/api/tests/test_ml_registry.py`
- Create: `apps/api/scripts/download_models.py`
- Create: `docs/MODELS.md`

**Interfaces:**
- `MlTask = Literal["denoise", "superres", "separation", "asr", "neural_codec"]`.
- `ModelSpec(task, model_id, revision, license, size_bytes, files, loader_name)`.
- `MODEL_SPECS: dict[MlTask, ModelSpec]` pins:
  - denoise: `Ceva-IP/DPDFNet` @ `dd6818d00f50c836fed43a6243ebe49116de5964`, `onnx/dpdfnet2_48khz_hr.onnx`, Apache-2.0, ~10.6 MB.
  - superres: `TigreGotico/audiosronnx-lavasr` @ `b3df8a262cf44e59bf84a40b7084f4479ca566b4`, `backbone.onnx` + `spec_head.onnx` + `denoiser_core.onnx`, Apache-2.0 (upstream LavaSR), 57.1 MB; the ONNX repo card has no license field (D-040).
  - separation: `adefossez/HTDemucs` @ `cbc8a9b1a87023b7fd74e7b3412e6321c0eab003`, 84 MB; note upstream MIT / card gap.
  - asr: `openai/whisper-tiny` @ `169d4a4341b33bc18d8881c4b69c2e104e1cc0af`, Apache-2.0, 151.1 MB.
  - neural_codec: `facebook/encodec_48khz` @ `c3def8e7185ac8c8efdce6eb8c4a651e487a503e`, MIT, 76.3 MB.
- `ModelRegistry(cache_dir)` methods `status(task) -> ModelStatus`, `require(task) -> ModelRunner`; `status` never imports heavy packages.
- `GET /models` returns `ModelsResponse(models: list[ModelInfo])` with `state` in `available|missing|loading|error`, `license`, `revision`, `size_bytes`.
- `apps/api/scripts/download_models.py` supports `--check` and `--all`; uses `huggingface_hub.snapshot_download` and direct DPDFNet download; writes a manifest.

- [ ] **Step 1: Write `test_ml_registry.py`** with a temporary cache: missing models report `missing`; a fake spec with one existing file reports `available`; `require` on missing raises `ApiError(model_unavailable, 503)`; `/models` returns all five tasks.
- [ ] **Step 2: Run** `uv run --directory apps/api pytest -q tests/test_ml_registry.py` — expected FAIL.
- [ ] **Step 3: Implement specs/registry/route**; no heavy imports at module import time.
- [ ] **Step 4: Implement `apps/api/scripts/download_models.py`** with `--check` first; `--all` downloads only after explicit flag.
- [ ] **Step 5: Write `docs/MODELS.md`** with the five specs, licenses, sizes, input rates, and loaders.
- [ ] **Step 6: Run** registry tests, `ruff`, `mypy` — expected PASS.
- [ ] **Step 7: Commit** `feat(F14): add pinned model registry and download script`.

### Task 4: Bounded job manager and SSE routes

**Files:**
- Create: `apps/api/src/avalab_api/ml/jobs.py`
- Create: `apps/api/src/avalab_api/ml/audio.py`
- Create: `apps/api/src/avalab_api/routes/ml.py`
- Modify: `apps/api/src/avalab_api/main.py`
- Create: `apps/api/tests/test_ml_jobs.py`
- Create: `apps/api/tests/test_ml_routes.py`

**Interfaces:**
- `MlJobRequest(audio_id: str, params: dict[str, object] = {})`, `MlJobResponse(job_id: str)`.
- `JobEvent(event: Literal["progress","done","error","cancelled"], progress: float | None, result: dict[str, object] | None, code: str | None)`.
- `MlResult(kind: Literal["audio","stems","transcript"], samples: list[float] | None = None, sample_rate_hz: int | None = None, stems: list[dict[str, object]] | None = None, text: str | None = None, segments: list[dict[str, object]] | None = None, language: str | None = None, stats: dict[str, object] = {})`.
- `ModelRunner.run(samples: np.ndarray, sample_rate_hz: int, params: dict[str, object], progress: Callable[[float], None]) -> MlResult`.
- `JobManager(storage, max_workers=1, queue_limit=8, ttl_seconds=3600)`:
  - `submit(task, request, runner) -> str`
  - `events(job_id) -> Iterator[JobEvent]`
  - `cancel(job_id) -> bool`
  - `shutdown()`
- After the runner returns, the manager persists `kind="audio"` samples via `write_result_wav` and replaces them with `result_audio_id`; for `kind="stems"`, it persists each stem and replaces its samples with `result_audio_id`, keeping the fixed order. TTL cleanup deletes those stored WAVs.
- `audio.py`: `read_canonical_mono(storage, audio_id) -> tuple[np.ndarray, int]`, `duration_seconds`, `write_result_wav(storage, samples, rate) -> str`, `resample_to(samples, from_hz, to_hz)`.
- Routes:
  - `POST /ml/{task}` validates task and 30 s cap, returns 202 `{job_id}`.
  - `GET /jobs/{job_id}/events` streams `text/event-stream`; sends current snapshot on connect, then progress/done/error/cancelled.
  - `DELETE /jobs/{job_id}` returns `{cancelled: bool}`.
  - Unknown job → 404 `job_not_found`; queue full → 429 `ml_busy`.

- [ ] **Step 1: Write job-manager tests** with a fake runner that emits 0/50/100 progress and sleeps; assert one-at-a-time execution with two jobs, queue cap, cancel between progress events, audio/stem persistence, TTL cleanup (including stored WAVs), and no result after cancel.
- [ ] **Step 2: Write route tests** with a fake runner injected into app state; assert 202, SSE frame order (`progress` then `done` with `result_audio_id`), `DELETE` cancellation, 404, 429, 30 s rejection.
- [ ] **Step 3: Run** `uv run --directory apps/api pytest -q tests/test_ml_jobs.py tests/test_ml_routes.py` — expected FAIL.
- [ ] **Step 4: Implement manager/audio/routes**; wire `app.state.ml_jobs`, `app.state.model_registry`, and storage in `create_app`; shut down in lifespan.
- [ ] **Step 5: Run** focused tests, full API tests, `ruff`, `mypy` — expected PASS.
- [ ] **Step 6: Commit** `feat(F14): add bounded ML jobs and SSE routes`.

### Task 5: Frontend AI shell

**Files:**
- Create: `apps/web/src/features/ai/aiState.ts`
- Create: `apps/web/src/features/ai/aiClient.ts`
- Create: `apps/web/src/features/ai/useAiJob.ts`
- Create: `apps/web/src/features/ai/aiLabView.tsx`
- Create: `apps/web/src/features/ai/aiState.test.ts`
- Create: `apps/web/src/features/ai/aiClient.test.ts`
- Create: `apps/web/src/features/ai/useAiJob.test.ts`
- Modify: `apps/web/src/app/routes.tsx`
- Modify: `apps/web/src/app/sidebar.tsx`
- Modify: `apps/web/src/i18n/en.json`
- Modify: `apps/web/src/i18n/fa.json`

**Interfaces:**
- `AiTask = "denoise" | "superres" | "separation" | "asr" | "neural-codec"`.
- `AI_TASKS` ordered list; `aiTaskFromSearch(search)` / `aiTaskToSearch(task)` with unknown fallback `denoise`.
- `AiClient`:
  - `getModels(): Promise<ModelsResponse>`
  - `uploadExcerpt(input: {samples, sampleRateHz, startSample, endSample}): Promise<string>`
  - `startJob(task, body): Promise<{job_id: string}>`
  - `streamJob(jobId, onEvent): Promise<void>`
  - `cancelJob(jobId): Promise<void>`
- `useAiJob` state: `idle | uploading | running | done | error | cancelled`; progress, result, errorKey; `run()`, `cancel()`.
- `AiLabView`: five tabs, `?task=` sync, model status banner, disabled run buttons when backend/model missing, placeholder per tab.

- [ ] **Step 1: Write `aiState.test.ts`** for task parsing/encoding and unknown fallback.
- [ ] **Step 2: Write `aiClient.test.ts`** with a fake client seam: excerpt upload caps at 30 s, `startJob` body validation, SSE parser handles split frames/comments/multiple events, backend envelope errors map to keys.
- [ ] **Step 3: Write `useAiJob.test.ts`** with a fake client: idle → uploading → running → done; cancel → cancelled; error keeps last progress; no state update after unmount.
- [ ] **Step 4: Run** `pnpm --filter @avalab/web exec vitest run src/features/ai` — expected FAIL.
- [ ] **Step 5: Implement state/client/hook/view**, add route + sidebar `nav.ai`, add `ai.*` keys.
- [ ] **Step 6: Run** `pnpm check` — expected PASS.
- [ ] **Step 7: Commit** `feat(F14): add AI lab shell and job client`.

### Task 6: Generated client, docs, shell e2e

**Files:**
- Modify: `apps/web/src/api/schema.d.ts` (generated)
- Modify: `apps/web/e2e/tools.spec.ts`
- Modify: `docs/PROGRESS.md`
- Modify: `docs/DECISIONS.md`

**Interfaces:**
- `pnpm gen:api` regenerates the schema from the running API.
- E2E expects `/tools/ai` and a Persian/English “AI lab” heading; backend-absent run controls are disabled; zero console errors.

- [ ] **Step 1: Start API, run** `pnpm gen:api`; commit only the generated schema change.
- [ ] **Step 2: Update the e2e tool list** from “nine routes” to the actual count and add `/tools/ai` with loose fa/en title match.
- [ ] **Step 3: Add D-032–D-036 entries** and update `PROGRESS.md` with Plan 01 status.
- [ ] **Step 4: Run** `pnpm check`, `pnpm e2e`, API tests — expected PASS.
- [ ] **Step 5: Commit** `docs(F14): close ML platform plan`.

## Completion Gate

- `/models` works with an empty cache and reports all five models.
- A fake job streams progress and completes; cancel and queue cap tested.
- AI route renders both locales, backend absent, zero console errors.
- No heavy ML import happens in the default pytest run.
- Demo assets verify with `fetch_f14.py --check`.
