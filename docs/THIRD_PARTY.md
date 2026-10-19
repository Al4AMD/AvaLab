# THIRD_PARTY.md — third-party components

> Every library, tool, font and other third-party component bundled with, linked by, or
> required to run AvaLab, with the version actually pinned in the lockfiles and its license.
> The project itself is licensed GPL-3.0 (see `docs/DECISIONS.md` D-001); every bundled
> dependency MUST be GPLv3-compatible (MIT / BSD / Apache-2.0 are compatible).
>
> **ffmpeg is NOT linked.** It is invoked as a separate process (subprocess with argument
> arrays) for decoding/encoding; its license does not propagate to this project.
>
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
| clsx | 2.1.1 | MIT |
| tailwind-merge | 3.7.0 | MIT |
| openapi-fetch | 0.17.0 | MIT |
| openapi-typescript | 7.13.0 | MIT |
| vite | 8.3.4 | MIT |
| @vitejs/plugin-react | 6.1.2 | MIT |
| vitest | 5.0.5 | MIT |
| typescript | 5.9.3 (`apps/web`), 7.0.2 (`packages/dsp`) | Apache-2.0 |
| tailwindcss | 4.3.3 | MIT |
| @tailwindcss/vite | 4.3.3 | MIT |
| @playwright/test | 1.64.1 | Apache-2.0 |
| @biomejs/biome | 2.5.15 | MIT |

## Python (apps/api/uv.lock, tools/golden/uv.lock)

| Component | Version | License |
|---|---|---|
| fastapi | 0.146.0 | MIT |
| starlette | 1.9.0 | BSD-3-Clause |
| pydantic | 2.14.1 | MIT |
| pydantic-settings | 2.16.0 | MIT |
| uvicorn | 0.54.0 | BSD-3-Clause |
| python-multipart | 0.0.32 | Apache-2.0 |
| httpx | 0.28.1 | BSD-3-Clause |
| mypy | 2.4.0 | MIT |
| pytest | 9.1.1 | MIT |
| ruff | 0.17.1 | MIT |
| numpy | 2.5.4 | BSD-3-Clause |
| scipy | 1.18.1 | BSD-3-Clause |

## Fonts

| Component | Version | License | Provenance |
|---|---|---|---|
| Vazirmatn | v33.003 | OFL-1.1 (license text: `apps/web/public/fonts/OFL.txt`) | Self-hosted woff2 files (regular 400 / medium 500 / semibold 600 / bold 700) extracted from the official `vazirmatn-v33.003.zip` release archive: <https://github.com/rastikerdar/vazirmatn/releases/tag/v33.003> |

## System tools

| Component | Version | License | Usage |
|---|---|---|---|
| ffmpeg / ffprobe | deployment-provided (validated at runtime by `GET /health`) | LGPL/GPL depending on build | Invoked as a **separate process**, never linked; not bundled in the repository |
