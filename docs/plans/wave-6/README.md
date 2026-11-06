# Wave 6 — Full Feature Closure and Release

Design: [`design.md`](design.md) (approved).

Scope: close all remaining P0/P1 gaps, implement F13/F15/F18 and the deferred F08/F09/F12/F14/F16 items, polish, deploy, and produce the Persian PDF report + slides.

All eight implementation plans are written. Plan order:

| Plan | Scope |
|---|---|
| [`00-baseline.md`](00-baseline.md) | Baseline fixes, gap audit, main-thread cleanup |
| [`01-psychoacoustics.md`](01-psychoacoustics.md) | F13 model, MDCT integration, tool view |
| [`02-pipeline.md`](02-pipeline.md) | F15 DAG DSL, engine, worker op, UI |
| [`03-quality-of-life.md`](03-quality-of-life.md) | F18 BS.1770, gain seam, theme, shortcuts |
| [`04-feature-gaps.md`](04-feature-gaps.md) | F08, F09, F12, F14, F16 |
| [`05-polish.md`](05-polish.md) | Performance, accessibility, responsive, Persian review |
| [`06-deployment.md`](06-deployment.md) | Docker, offline models, proxy runbook |
| [`07-release.md`](07-release.md) | PDF report, PDF slides, final docs, closeout |

Never cut a P0 feature for this wave.
