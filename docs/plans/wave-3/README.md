# Wave 3 — Signals & Systems labs

Planned scope (AGENTS §5 M2): F03 sampling/bit-depth lab, F07 signal extent
lab, F09 Re/Im editor with Hermitian toggle, F10 reverse + reverb, F06
speed/direction.

| Plan | Scope | Status |
|---|---|---|
| `01-playback-and-speed.md` | Processed-playback lane, dock A/B, F06 speed/direction | **done** (2026-11-01); F06 verified by Wave 4 Plan 04 (2026-11-02) |
| `02-sampling-bit-depth.md` | F03 resampling, quantization, dither, aliasing demo | **done** (2026-11-01) |
| `03-signal-extent.md` | F07 shift/scale/reverse/truncate/zero-pad, support/energy/power | **done** (2026-11-01) |
| `04-reverse-reverb.md` | F10 reverse, synthetic/uploaded IRs, convolution timing | **done** (2026-11-01) |
| `05-spectrum-editor.md` | F09 Re/Im/mag/phase edits, Hermitian toggle, presets | **done** (2026-11-01) |

Execution order: 01 → 02 → 03 → 04 → 05. Every plan depends on plan 01's
processed lane; plan 04 reuses plan 03's reverse op.

Authority order when plans conflict: `AGENTS.md` → `docs/DECISIONS.md` →
the wave plan.
