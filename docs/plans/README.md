# AvaLab plans — index

One folder per wave. Each plan file is an executable SDD plan (subagent-driven development).
Statuses: `planned` → `executing` → `done`.

| Wave | Folder | Plans | Status |
|---|---|---|---|
| 0 | `wave-0/` | `foundation.md` | executing |
| 1 | `wave-1/` | `01-fourier-transforms.md`, `02-signals-and-metrics.md`, `03-systems-and-filters.md`, `04-codecs-and-time.md` | planned |
| 2 | `wave-2/` | (Core visuals: F01 UI, F02 waveform/spectrogram, F08 basic, F12 generator UI) | not planned yet |
| 3 | `wave-3/` | (Signals & Systems labs: F03, F07, F09, F10, F06 speed) | not planned yet |
| 4 | `wave-4/` | (Multimedia core: F04 codecs, F05 metrics UI, rate–distortion, F06 time-stretch) | not planned yet |
| 5 | `wave-5/` | (Intelligence & teaching: F14 ML jobs, F11 filters UI, F16 education) | not planned yet |
| 6 | `wave-6/` | (Polish & release: F13, F15, F18, perf/a11y pass, PDF report + slides, deployment) | not planned yet |

Authority order when plans conflict: `AGENTS.md` (spec) → `docs/DECISIONS.md` → the wave plan.
Ledgers live in `.superpowers/sdd/<plan-basename>/progress.md` (git-ignored scratch, not committed).
