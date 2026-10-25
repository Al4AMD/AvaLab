# AvaLab plans — index

One folder per wave. Each plan file is an executable SDD plan (subagent-driven development).
Statuses: `planned` → `executing` → `done`.

| Wave | Folder | Plans | Status |
|---|---|---|---|
| 0 | `wave-0/` | `foundation.md` | done (2026-10-19; per-task commits `c56fbe2..ea68089` (T13) plus follow-up docs fixes — see `docs/PROGRESS.md`) |
| 1 | `wave-1/` | `01-fourier-transforms.md`, `02-signals-and-metrics.md`, `03-systems-and-filters.md`, `04-codecs-and-time.md` | done (2026-10-25; PRs #1–#5 → `main`) |
| 2 | `wave-2/` | `01-app-and-session.md`, `02-audio-sources-playback.md`, `03-waveform-spectrogram.md`, `04-fourier-generator.md` (F01/F02/F08/F12 core visuals; spec: `docs/superpowers/specs/2026-10-25-wave-2-core-visuals-design.md`) | executing |
| 3 | `wave-3/` | (Signals & Systems labs: F03, F07, F09, F10, F06 speed) | not planned yet |
| 4 | `wave-4/` | (Multimedia core: F04 codecs, F05 metrics UI, rate–distortion, F06 time-stretch) | not planned yet |
| 5 | `wave-5/` | (Intelligence & teaching: F14 ML jobs, F11 filters UI, F16 education) | not planned yet |
| 6 | `wave-6/` | (Polish & release: F13, F15, F18, perf/a11y pass, PDF report + slides, deployment) | not planned yet |

Authority order when plans conflict: `AGENTS.md` (spec) → `docs/DECISIONS.md` → the wave plan.
Ledgers live in `.superpowers/sdd/<plan-basename>/progress.md` (git-ignored scratch, not committed).
