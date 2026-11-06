# Wave 7 — post-0.1.0 backlog

Status: planned (2026-11-07). These items are not part of the v0.1.0 gate.
Implement one vertical slice at a time; do not start while a gate is failing.

| Priority | Feature | Task | Depends on |
|---|---|---|---|
| 1 | F01 | Add a stereo playback lane while keeping mono analysis and the existing processed lane. Preserve source channels through ingest; test fa/en and A/B playback. | — |
| 2 | F02 | Add a general processed-spectrogram before/after comparison instead of per-tool result views. Reuse the existing spectrogram painter and cache derived buffers. | F01 optional |
| 3 | F16 | Add the student PDF/HTML lab-report export: parameters, metrics, selected screenshots, and theory citations. Keep user audio out of share URLs. | Exported WAV chart assets |
| 4 | F14 | Add AudioSet classification as a small, pinned CPU model with a 30 s excerpt cap and an honest approximation caption. Verify license/size in `docs/MODELS.md` before implementation. | Model selection |

## Notes

- Keep the current mono-only and per-tool comparison behavior until the
  replacement lands; no silent removal.
- Each task needs golden/property or e2e coverage, bilingual copy, theory copy,
  `docs/PROGRESS.md`, and the usual gates.
- Classification is P3; cut it first if time or model budget is tight.
