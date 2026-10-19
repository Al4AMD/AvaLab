# AvaLab (آوالب)

Bilingual (Persian/English) web-based audio laboratory for teaching *Signals and Systems* and *Multimedia Systems*. Load an audio file, apply signal-processing and compression algorithms, and see and hear the effect — waveform, spectrogram, Fourier views, sampling and quantization, codecs, metrics, filters, reverb, and ML tools. See `AGENTS.md` for the full specification and `docs/plans/` for the implementation plan.

## Prerequisites

- Node.js 22 (`>=22`) with corepack (provides `pnpm@11.21.0`)
- Python 3.12 and [uv](https://docs.astral.sh/uv/) 0.12+
- ffmpeg / ffprobe 9.x on `PATH` (backend decoding/encoding)
- Docker + Compose — optional, only for the containerized deployment

## Install

```sh
corepack enable
pnpm install
uv sync --directory apps/api
uv sync --directory tools/golden
uv sync --directory tools/demo_clips
```

## Development

```sh
pnpm dev:web   # Vite dev server (web app)      http://localhost:5173
pnpm dev:api   # uvicorn (API, autoreload)      http://localhost:8000
```

The web dev server proxies `/api` to the API; browser-side tools keep working when the API is offline.

## Checks

```sh
pnpm check      # Biome lint/format, TS typecheck, Vitest, i18n key check
pnpm e2e        # Playwright smoke (builds web, chromium)
pnpm test:api   # backend pytest (uv run --directory apps/api pytest -q)
uv run --directory apps/api ruff check .
uv run --directory apps/api mypy src
uv run --directory tools/golden pytest -q
```

Regenerate artifacts when their sources change:

```sh
pnpm gen:golden   # golden-vector fixtures (tools/golden -> packages/dsp/test-data/golden)
pnpm gen:api      # TypeScript client from the committed OpenAPI spec
uv run --directory tools/demo_clips python generate.py   # bundled demo WAVs (deterministic)
```

## Docker

```sh
docker compose up --build
```

Web is served on **http://localhost:8080** (Caddy serves the static build and proxies `/api/*` to the API container). API: <http://localhost:8080/api/v1/health>.

## Layout

- `apps/web` — React + TypeScript + Vite SPA (i18n/RTL shell, later the tool UIs)
- `apps/api` — FastAPI backend (ingest, codecs via ffmpeg, ML jobs)
- `packages/dsp` — pure TypeScript DSP library (no DOM), runs in Workers
- `tools/golden` — Python/NumPy reference-vector generators for DSP tests
- `tools/demo_clips` — deterministic generator for the bundled demo audio clips
- `docker` — Dockerfiles + Caddy config; `compose.yaml` at the root
- `docs` — plans (`docs/plans/`), decisions, progress log, algorithms, models, third-party register
- `scripts` — repo tooling (OpenAPI client generation, i18n key checker)
