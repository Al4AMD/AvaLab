# AvaLab plans — index

One folder per wave. Each plan file is an executable SDD plan (subagent-driven development).
Statuses: `planned` → `executing` → `done`.

| Wave | Folder | Plans | Status |
|---|---|---|---|
| 0 | `wave-0/` | `foundation.md` | done (2026-10-19; per-task commits `c56fbe2..ea68089` (T13) plus follow-up docs fixes — see `docs/PROGRESS.md`) |
| 1 | `wave-1/` | `01-fourier-transforms.md`, `02-signals-and-metrics.md`, `03-systems-and-filters.md`, `04-codecs-and-time.md` | done (2026-10-25; PRs #1–#5 → `main`) |
| 2 | `wave-2/` | `01-app-and-session.md`, `02-audio-sources-playback.md`, `03-waveform-spectrogram.md`, `04-fourier-generator.md` (F01/F02/F08/F12 core visuals; spec: `docs/superpowers/specs/2026-10-25-wave-2-core-visuals-design.md`) | done (2026-11-01) |
| 3 | `wave-3/` | `01-playback-and-speed.md`, `02-sampling-bit-depth.md`, `03-signal-extent.md`, `04-reverse-reverb.md`, `05-spectrum-editor.md` (F03/F06/F07/F09/F10) | done (2026-11-01; PR #9 → `main`) |
| 4 | `wave-4/` | `01-browser-codec-lab.md`, `02-backend-real-codecs.md`, `03-real-codec-ui-and-metrics.md`, `04-comparison-rate-distortion-closeout.md` (F04/F05/F06) | executing (2026-11-02; plans 01–03 done) |
| 5 | `wave-5/` | (Intelligence & teaching: F14 ML jobs, F11 filters UI, F16 education) | not planned yet |
| 6 | `wave-6/` | (Polish & release: F13, F15, F18, perf/a11y pass, PDF report + slides, deployment) | not planned yet |

Authority order when plans conflict: `AGENTS.md` (spec) → `docs/DECISIONS.md` → the wave plan.
Ledgers live in `.superpowers/sdd/<plan-basename>/progress.md` (git-ignored scratch, not committed).
