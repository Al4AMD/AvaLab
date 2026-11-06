# THIRD_PARTY.md — third-party components

> Every library, tool, font and other third-party component bundled with, linked by, or
> required to run AvaLab, with the version actually pinned in the lockfiles and its license.
> The project itself is licensed GPL-3.0 (see `docs/DECISIONS.md` D-001); every bundled
> dependency MUST be GPLv3-compatible (MIT / BSD / Apache-2.0 are compatible).
>
> **ffmpeg is NOT linked.** It is invoked as a separate process (subprocess with argument
> arrays) for decoding/encoding; its license does not propagate to this project.
>
> MPL-2.0 components (`certifi`, `pathspec`) are GPLv3-compatible (FSF-acknowledged) and are
> dev/test-only transitive dependencies, not part of the shipped runtime.
>
> Versions below are the resolved versions in `pnpm-lock.yaml` / the `uv.lock` files.
> Model weights are tracked separately in `docs/MODELS.md`.

## JavaScript / TypeScript (pnpm-lock.yaml)

| Component | Version | License |
|---|---|---|
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| @types/react | 19.3.0 | MIT |
| @types/react-dom | 19.3.0 | MIT |
| i18next | 26.5.2 | MIT |
| react-i18next | 17.1.0 | MIT |
| react-router | 8.5.0 | MIT |
| clsx | 2.1.1 | MIT |
| tailwind-merge | 3.7.0 | MIT |
| openapi-fetch | 0.17.0 | MIT |
| openapi-typescript | 7.13.0 | MIT |
| zustand | 5.0.16 | MIT |
| uplot | 1.6.32 | MIT |
| @xyflow/react | 12.12.1 | MIT |
| fft.js | 4.0.4 | MIT |
| katex | 0.19.1 | MIT |
| vite | 8.3.4 | MIT |
| @vitejs/plugin-react | 6.1.2 | MIT |
| vitest | 5.0.5 | MIT |
| typescript | 5.9.3 (`apps/web`), 7.0.2 (`packages/dsp`) | Apache-2.0 |
| tailwindcss | 4.3.3 | MIT |
| @tailwindcss/vite | 4.3.3 | MIT |
| @playwright/test | 1.64.1 | Apache-2.0 |
| @biomejs/biome | 2.5.15 | MIT |
| @types/node | 26.6.5 | MIT |

Wave 6 added `@xyflow/react` 12.12.1 (MIT, <https://reactflow.dev>) for the F15 pipeline graph editor. Its transitive `@xyflow/system` 0.0.84 is MIT and its `d3-*` interaction packages are ISC. Wave 6 Plan 04 added `fft.js` 4.0.4 (MIT) as the independent FFT baseline for the F08 benchmark panel; it is never on the audio path. Wave 5 added `katex` 0.19.1 (MIT) for the theory panels; Wave 4 added no new JS dependency. The comparison table and rate–distortion chart reuse the already-listed `uplot` 1.6.32 (MIT); real codecs keep using the separately-invoked `ffmpeg` binary.

## Python (apps/api/uv.lock, tools/golden/uv.lock, tools/demo_clips/uv.lock)

| Component | Version | License |
|---|---|---|
| annotated-doc | 0.0.5 | MIT |
| annotated-types | 0.8.0 | MIT |
| anyio | 4.15.1 | MIT |
| ast-serialize | 0.13.1 | MIT |
| audioread | 3.1.0 | MIT |
| certifi | 2026.10.18 | MPL-2.0 |
| click | 8.5.0 | BSD-3-Clause |
| cloudpickle | 3.1.2 | BSD-3-Clause |
| colorama | 0.4.6 | BSD-3-Clause |
| decorator | 5.3.1 | BSD-2-Clause |
| fastapi | 0.146.0 | MIT |
| h11 | 0.16.0 | MIT |
| httpcore | 1.0.9 | BSD-3-Clause |
| httptools | 0.9.0 | MIT |
| httpx | 0.28.1 | BSD-3-Clause |
| idna | 3.20 | BSD-3-Clause |
| iniconfig | 2.3.1 | MIT |
| joblib | 1.6.0 | BSD-3-Clause |
| lazy-loader | 0.6 | BSD-3-Clause |
| librosa | 0.11.0 | ISC |
| librt | 0.16.0 | MIT |
| llvmlite | 0.44.0 | BSD-2-Clause |
| msgpack | 1.2.4 | Apache-2.0 |
| mypy | 2.4.0 | MIT |
| mypy-extensions | 1.1.0 | MIT |
| narwhals | 2.28.0 | MIT |
| numba | 0.61.2 | BSD-2-Clause |
| numpy | 2.5.4 | BSD-3-Clause (bundled: 0BSD, MIT, Zlib, CC0-1.0) |
| opentelemetry-api | 1.45.1 | Apache-2.0 |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause |
| pathspec | 1.1.1 | MPL-2.0 |
| platformdirs | 4.14.5 | MIT |
| pluggy | 1.7.0 | MIT |
| pooch | 1.9.0 | BSD-3-Clause |
| pydantic | 2.14.1 | MIT |
| pydantic-core | 2.50.1 | MIT |
| pydantic-settings | 2.16.0 | MIT |
| pygments | 2.21.0 | BSD-2-Clause |
| pytest | 9.1.1 | MIT |
| python-dotenv | 1.2.4 | BSD-3-Clause |
| python-multipart | 0.0.32 | Apache-2.0 |
| pyyaml | 6.0.3 | MIT |
| ruff | 0.17.1 | MIT |
| scikit-learn | 1.9.1 | BSD-3-Clause |
| scipy | 1.18.1 | BSD-3-Clause |
| soxr | 1.1.0 | LGPL-2.1-or-later |
| starlette | 1.9.0 | BSD-3-Clause |
| threadpoolctl | 3.8.0 | BSD-3-Clause |
| typing-extensions | 4.16.0 | PSF-2.0 |
| typing-inspection | 0.4.4 | MIT |
| uvicorn | 0.54.0 | BSD-3-Clause |
| uvloop | 0.23.0 | MIT |
| watchfiles | 1.3.0 | MIT |
| websockets | 17.2 | BSD-3-Clause |

Wave 6 added `librosa` 0.11.0 (ISC) to the API base for non-neural F14 pitch/beat analysis. Its `soxr` 1.1.0 dependency is LGPL-2.1-or-later; it is used as a library and remains GPLv3-compatible. `numba` is pinned below 0.62 because later llvmlite releases have no macOS x86_64 wheel (llvmlite 0.50 requires a local LLVM build).

### ML extra (`apps/api[ml]`, not installed by default or in CI)

| Component | Version | License |
|---|---|---|
| torch | 2.15.0 (Linux/Docker, `+cpu` wheel), 2.2.2 (Intel macOS) | BSD-3-Clause |
| torchaudio | 2.11.1 (Linux/Docker, `+cpu` wheel), 2.2.2 (Intel macOS) | BSD-2-Clause |
| transformers | 4.57.6 | Apache-2.0 |
| demucs | 4.1.0 | MIT |
| sherpa-onnx | 2.0.1 | Apache-2.0 |
| audiosronnx | 0.0.1 | Apache-2.0 |
| onnxruntime | 1.31.1 (Linux), 1.23.2 (Intel macOS) | MIT |
| huggingface-hub | 0.36.2 | Apache-2.0 |
| soundfile | 0.14.0 | BSD-3-Clause |

Model weights are third-party assets tracked with revisions and licenses in `docs/MODELS.md`; they are downloaded at setup time, never committed or bundled.

## Fonts

| Component | Version | License | Provenance |
|---|---|---|---|
| Vazirmatn | v33.003 | OFL-1.1 (license text: `apps/web/public/fonts/OFL.txt`) | Self-hosted woff2 files (regular 400 / medium 500 / semibold 600 / bold 700) extracted from the official `vazirmatn-v33.003.zip` release archive: <https://github.com/rastikerdar/vazirmatn/releases/tag/v33.003> |

## System tools

| Component | Version | License | Usage |
|---|---|---|---|
| ffmpeg / ffprobe | deployment-provided (validated at runtime by `GET /health`); Debian slim-package build in `docker/api.Dockerfile` | LGPL/GPL depending on build | Invoked as a **separate process**, never linked or bundled into our code; not bundled in the repository |
| Caddy | `caddy:2-alpine` (deployment image, `docker/web.Dockerfile`) | Apache-2.0 | Serves the static web build and proxies `/api/*` to the api container; separate process, not linked |

## Audio assets (`apps/web/public/demo/`)

| Asset | License | Provenance |
|---|---|---|
| `chirp-log-100to8000hz-5s.wav` | CC0-1.0 (self-generated) | Generated by `tools/demo_clips/generate.py` (log sweep 100→8000 Hz, 48 kHz 16-bit mono, fixed parameters) |
| `pink-noise-5s.wav` | CC0-1.0 (self-generated) | Generated by `tools/demo_clips/generate.py` (seeded white noise shaped to 1/f power, seed 20261019) |
| `clicks-2hz-5s.wav` | CC0-1.0 (self-generated) | Generated by `tools/demo_clips/generate.py` (2 clicks/s exponentially decaying impulse train) |
| `speech-kathleen-19s.wav` | CC0-1.0 (source dataset) | Derived by `tools/demo_clips/fetch_f14.py` from three `rhasspy/dataset-voice-kathleen` `master` files: `arctic_a0407_1592707592.wav` (SHA-256 `53fc54eacb75cf5db35aba8dc28b56e6ab0eea7ff8b38c5a910ccfba11a4a8a1`), `arctic_b0496_1592526615.wav` (`43c4d9ae1aa570cc8d875076b58cee11e649c473aac449d310e4337ec84d5962`), `arctic_a0507_1592703857.wav` (`3113542e210f6a803ae419be50d8faea063b316400e79ec3b408a8dead8e8072`); concatenated with 0.4 s silence, mono 48 kHz 16-bit |
| `speech-kathleen-19s.txt` | CC0-1.0 (source dataset) | Reference transcript of the three utterances above; source `.txt` files in the same dataset |
| `speech-kathleen-noisy-5db-19s.wav` | CC0-1.0 (derived) | `speech-kathleen-19s.wav` plus deterministic pink noise at 5 dB SNR (`numpy.random.default_rng(20261103)`), clipped to [-1, 1] by `tools/demo_clips/fetch_f14.py` |
| `music-life-turns-15s.wav` | CC0-1.0 (source track) | 15 s excerpt from 75 s of “Life Turns to History” by The Oracle / Kaiser, `09_life_turns_to_history.flac` from OpenGameArt (`https://opengameart.org/sites/default/files/09_life_turns_to_history.flac`, SHA-256 `22273ebd073fda1ab5f827d2ae128e5e4ebdf7a9add5c3de9d295232c91be5e0`); mono 48 kHz 16-bit, peak-normalized to -1 dBFS |

All seven clips are dedicated to the public domain (CC0-1.0) or derived from CC0 sources; no copyrighted audio is committed. The self-generated generator and the F14 fetcher are deterministic (fixed seeds/params/offsets) — reruns produce byte-identical outputs for a fixed ffmpeg build.
