# Wave 7 — post-0.1.0 backlog

Status: items 1–4 implemented 2026-11-08; D-056 stereo phases 1–6 implemented 2026-11-07. These items are not part of the v0.1.0 gate.

Design: [`docs/superpowers/specs/2026-11-07-stereo-playback-and-real-codecs-design.md`](../../superpowers/specs/2026-11-07-stereo-playback-and-real-codecs-design.md) · Plan: [`docs/superpowers/plans/2026-11-07-stereo-playback-and-real-codecs.md`](../../superpowers/plans/2026-11-07-stereo-playback-and-real-codecs.md).
Implement one vertical slice at a time; do not start while a gate is failing.

| Priority | Feature | Task | Depends on |
|---|---|---|---|
| 1 | F01 | **Implemented 2026-11-07.** Stereo playback and stereo real-codec playback/export; mono analysis lane preserved; fa/en and A/B covered. | — |
| 2 | F02 | **Implemented 2026-11-08.** Spectrogram tool shows the processed lane beside the original with shared controls; chunk results are cached by buffer identity and analysis params. | F01 optional |
| 3 | F16 | **Implemented 2026-11-08.** Header lab-report action downloads printable HTML with source, parameters, metrics, visible figures and theory citations; user audio stays out of URLs and the report. | — |
| 4 | F14 | **Implemented 2026-11-08.** AST AudioSet classification, 346 MB BSD-3-Clause checkpoint, 10 s window averaging, top-k labels, 30 s excerpt cap, honest approximation/taxonomy copy. | — |

## D-056 stereo program

Design: [`2026-11-07-wave-7-d056-stereo-program-design.md`](../../superpowers/specs/2026-11-07-wave-7-d056-stereo-program-design.md) · Phase 1 plan: [`2026-11-07-d056-stereo-phase-1-channel-foundation.md`](../../superpowers/plans/2026-11-07-d056-stereo-phase-1-channel-foundation.md).

- **Phase 1 implemented 2026-11-07:** channel model, URL-backed `ch` selection, lane-aware derives, per-lane waveform/spectrogram/FFT/metrics, fa/en copy, theory, unit and e2e coverage.
- **Phase 2 implemented 2026-11-07:** grid-safe per-channel filters, spectrum editor, and hand-written toy codecs with linked-by-default right lanes, preserved untouched lanes, aggregate codec stats, fa/en copy, theory, unit and e2e coverage. Batch codec comparison remains mono.
- **Phase 3 implemented 2026-11-07:** grid-changing sampling, speed, and signal extent with linked-by-default right lanes; sampling/speed expose only grid-safe per-lane fields, extent shares all operation parameters; per-lane derives, combined playback, per-lane metrics, fa/en copy, theory, unit and e2e coverage.
- **Phase 4 implemented 2026-11-07:** true-stereo 4-path reverb matrix, 2/4-channel IR mapping, per-lane playback, fa/en copy, theory, unit and e2e coverage.
- **Phase 5 implemented 2026-11-07:** shared graph per selected lane, matched-grid output combining, per-lane output stats, fa/en copy, theory, unit and e2e coverage.
- **Phase 6 implemented 2026-11-07:** async whole-file codec jobs with SSE progress, cancel, TTL cleanup, mono-reference alignment, 200 MB upload default, Codec Lab whole-file UI, fa/en copy, unit, API, and e2e coverage.
- **Hardening:** full `pnpm check`, web build, full Playwright suite, backend pytest/ruff/mypy, offline AST smoke, and the six-model Docker acceptance smoke are green on 2026-11-08. Release documentation is updated in `docs/PROGRESS.md`, `docs/MODELS.md`, `docs/DECISIONS.md`, and `docs/DEPLOYMENT.md`.

Phase 2 plan: [`2026-11-07-d056-stereo-phase-2-grid-safe-processors.md`](../../superpowers/plans/2026-11-07-d056-stereo-phase-2-grid-safe-processors.md).
Phase 3 plan: [`2026-11-07-d056-stereo-phase-3-grid-changing-processors.md`](../../superpowers/plans/2026-11-07-d056-stereo-phase-3-grid-changing-processors.md).
Phase 4 plan: [`2026-11-07-d056-stereo-phase-4-true-stereo-reverb.md`](../../superpowers/plans/2026-11-07-d056-stereo-phase-4-true-stereo-reverb.md).
Phase 5 plan: [`2026-11-07-d056-stereo-phase-5-stereo-pipeline.md`](../../superpowers/plans/2026-11-07-d056-stereo-phase-5-stereo-pipeline.md).
Phase 6 plan: [`2026-11-07-d056-stereo-phase-6-async-codec-jobs.md`](../../superpowers/plans/2026-11-07-d056-stereo-phase-6-async-codec-jobs.md).

## Notes

- Per-tool result spectrograms remain; the general comparison is additive and no
  per-tool view was removed.
- Each task needs golden/property or e2e coverage, bilingual copy, theory copy,
  `docs/PROGRESS.md`, and the usual gates.
- Classification is P3 and now implemented; it remains outside the v0.1.0 gate.
