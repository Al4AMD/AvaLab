# Wave 5 — Intelligence and teaching

Planned scope (AGENTS §5 M4): F14 ML job manager, pinned model registry and
five tools (denoise, super-resolution, separation, ASR, neural codec); F11
filter-design lab; F16 education layer (theory panels, three guided
experiments, share-by-URL for demo clips, WAV/PNG export). GPU is optional;
CPU is the floor (D-002).

| Plan | Scope | Status |
|---|---|---|
| `01-ml-platform.md` | Demo assets, ML dependencies/config, model registry, download script, job manager + SSE, AI shell | **done** |
| `02-denoise-superres.md` | DPDFNet denoise and LavaSR super-resolution adapters + UI, sinc baseline | **done** |
| `03-separation-asr-codec.md` | htdemucs separation, Whisper tiny ASR + WER, Encodec neural codec + rate–distortion point | **pending** |
| `04-filter-lab.md` | F11 worker ops, state/URL, filter-design UI, pole-zero/stability | **pending** |
| `05-teaching-layer.md` | F16 theory framework, F11/F14 theory, `/experiments`, demo share, WAV/PNG export | **pending** |
| `06-closeout.md` | Full gates, docs, offline/model smoke, Docker smoke, Persian review list | **pending** |

Execution order: 01 → 02 → 03 → 04 → 05 → 06. Plan 04 is independent of the
ML plans and may run in parallel with 01–03. Plan 05 depends on 04 and on the
F14 tool surfaces from 02–03.

## Decisions pinned for this wave

- **D-032:** Denoising uses DPDFNet 48 kHz through `sherpa-onnx` 2.0.1
  (Apache-2.0, ~10.6 MB), not DeepFilterNet3. The pinned ONNX file is
  `Ceva-IP/DPDFNet` revision `dd6818d00f50c836fed43a6243ebe49116de5964`,
  `onnx/dpdfnet2_48khz_hr.onnx`. Reason: the `deepfilternet` package requires
  `numpy<2.0` and has no cp312 `deepfilterlib` wheel; DPDFNet avoids a custom
  STFT/ERB/deep-filter DSP port.
- **D-033:** ML dependencies are an optional `ml` extra in
  `apps/api/pyproject.toml`; default tests and CI stay light, Docker and the
  local demo install `--extra ml`. Real-model tests are gated by
  `AVALAB_RUN_ML_TESTS=1`.
- **D-034:** F14 ships as one `/tools/ai` route with five tabs
  (`?task=denoise|superres|separation|asr|neural-codec`), not five routes.
- **D-035:** ML jobs use an in-process bounded queue with max concurrency 1
  and SSE progress. No Redis/Celery. The excerpt cap is 30 s and the backend
  enforces it even when the frontend already sliced.
- **D-036:** F14 demo audio is CC0: three concatenated Kathleen utterances
  (speech), a seeded noisy derivative, and a 15 s excerpt of “Life Turns to
  History” (clean vocals). Provenance and source hashes live in
  `docs/THIRD_PARTY.md`.
- **D-037:** Super-resolution compares LavaSR against the existing
  `resampleRational` sinc path, so the experiment isolates the learned
  bandwidth extension.
- **D-038:** F16 share links encode only bundled demo clips (`demoId`), never
  user uploads. Unknown ids fall back to the normal empty state.
- **D-040:** Super-resolution downloads the ONNX artifacts from
  `TigreGotico/audiosronnx-lavasr` (the repo `audiosronnx` actually pins),
  not the upstream PyTorch-only `YatharthS/LavaSR`. The ONNX repo card has no
  license field; upstream LavaSR and the package declare Apache-2.0. Record
  the gap and use the local flat files with `audiosronnx`.
- **D-039:** Intel-macOS CPU compatibility is explicit. PyTorch stopped
  publishing Intel-mac wheels after 2.2.2, and that wheel requires NumPy 1.x.
  On `darwin`/`x86_64` the API therefore resolves `numpy>=1.26,<2`,
  `scipy>=1.16,<1.17`, `torch>=2.1,<2.3`, `torchaudio>=2.1,<2.3`, and
  `onnxruntime` resolves to its last Intel-mac build. Other platforms keep
  NumPy 2.x and `torch>=2.6`. `transformers` stays `<5` so the 2.2 path is
  supported. This is the owner's local demo target; it must be tested before
  close-out.

## Global gates

- `pnpm check` green; `pnpm e2e` green in `fa` (RTL) and `en` (LTR), zero
  console errors.
- Backend: `uv run --directory apps/api pytest -q`,
  `uv run --directory apps/api ruff check .`,
  `uv run --directory apps/api mypy .`.
- Model tests: `AVALAB_RUN_ML_TESTS=1 uv run --directory apps/api pytest -q -m ml`
  and `HF_HUB_OFFLINE=1` smoke before close-out.
- No model weights, generated build output, or secrets committed.
- Models ≤400 MB each, ≤2 GB total; pinned ids/revisions/licenses recorded in
  `docs/MODELS.md`. LavaSR ONNX repo and htdemucs card license gaps are
  recorded explicitly.
- No main-thread DSP; F11 uses the DSP worker.
- All strings through i18n; Persian copy is machine-drafted and flagged for
  owner review.
- Do not push or deploy without the owner’s request.

## Carries

- Persian review for every Wave 5 screen.
- Docker ffmpeg availability remains unverified from Wave 4.
- Metrics/comparison `realRow` main-thread computation from Wave 4 stays out
  of scope.
- A full-file ML run is intentionally unsupported; the UI labels all ML
  results as excerpt-based.
- AI outputs are approximations and must carry the honest caption.

Authority order when plans conflict: `AGENTS.md` → `docs/DECISIONS.md` →
this wave plan.
