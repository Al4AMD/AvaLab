# D-056 Phase 4 — True-stereo 4-path reverb

## Goal

Add a true-stereo reverb mode to F10 while keeping the existing mono reverb
path byte-for-byte compatible.

Signal model:

```text
yL = xL * LL + xR * RL
yR = xL * LR + xR * RR
```

## Tasks

1. **Worker op** — add `reverbStereoProcess` to `apps/web/src/session/ops.ts`
   and the worker dispatch/handler table. A planar Float32 payload carries
   `[xL, xR, IR...]`; the result carries planar `[yL, yR]`.
   - Built-in IRs: `LL`/`RR` use the preset IR/seed; `LR`/`RL` use adjacent
     seeds (`seed + 1`, `seed + 2`) and a fixed cross gain of `0.5`.
   - Uploaded 2-channel IR: `LL = L`, `RR = R`, cross paths zero.
   - Uploaded 4-channel IR: documented order `LL, LR, RL, RR`.
   - Pre-delay applies to both source lanes; wet/dry is shared.
   - Output length `preDelay + N + max(IR lengths) - 1`.
   - Direct convolution only for inputs ≤ 2 s; FFT otherwise.
   - Tests: 4-path matrix with delta taps, 2-channel diagonal IR, diagonal
     equivalence with the mono reverb, FFT/direct agreement, validation and
     output-cap guards.

2. **State** — extend `ReverbSettings` with the shared channel selection
   (`mono`, `left`, `right`, `stereo`). `stereo` serializes as `ch=both`
   through the existing channel URL codec. No per-lane reverb parameters:
   the IR, mix, pre-delay, method and range stay shared because the reverb
   is one LTI system applied to the stereo pair.

3. **View** — add the channel picker. `mono`, `left` and `right` keep the
   existing mono `reverbProcess`; `stereo` derives both source lanes with
   `reverbStereoProcess` and installs two processed channels. Left/right
   solo outputs mono. Uploaded IRs accept 2 or 4 channels in stereo mode
   (1 channel stays valid for mono/left/right); the IR panel shows the
   selected/first path and documents the 4-channel order.

4. **Copy, theory, docs, e2e** — fa/en copy for the channel picker, stereo
   IR rules and per-path note; theory section for the 4-path matrix; update
   `docs/ALGORITHMS.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md` and the
   Wave 7 README. Extend `e2e/stereo-processors.spec.ts` with a stereo
   reverb flow and keep the existing mono reverb e2e green.

## Verification

- `pnpm check`
- `pnpm --filter @avalab/web build`
- `pnpm --filter @avalab/web exec playwright test e2e/reverb.spec.ts e2e/stereo-processors.spec.ts e2e/channel-analysis.spec.ts`
- Mono URL/storage, DOM and test IDs unchanged.
- No worker protocol shape change beyond the new op entry.
