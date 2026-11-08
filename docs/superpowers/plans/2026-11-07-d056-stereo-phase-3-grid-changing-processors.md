# D-056 Phase 3 — Grid-Changing Stereo Processors

Status: ready to execute
Date: 2026-11-07
Spec: `docs/superpowers/specs/2026-11-07-wave-7-d056-stereo-program-design.md` §4, §6, §7 (F03/F06/F07)
Scope: sampling, speed, signal extent. No owner gates, no commits without explicit approval.

## Goal

Let the three grid-changing labs process left, right, or both lanes. Shared grid
fields force equal output rate/length. Mono behavior, URLs, test IDs, and output
bytes stay unchanged.

## Architecture

- Reuse `useChannelMode`, `ChannelPicker`, `LaneParams`, and the Phase 2 lane
  derive helpers.
- Shared frame fields live outside lane params: sampling rate/anti-alias;
  speed/mode/pitch; extent operation and length arguments.
- Independent fields: sampling bits/dither, speed reverse. Extent has none.
- Both mode calls the existing worker op once per lane with
  `deriveWithSourceSliceLane`; mono keeps the existing standalone/slice path.
- Combine settled lane buffers with a new grid-changing helper
  `combineLaneOutputs` (no source passthrough, so left/right output is mono).
- Reject mismatched lane lengths before `setProcessed`.
- URL state adds `right` overrides with `rr` keys and `el=right`; old URLs
  decode to linked primary settings.

## Task 1 — Grid-changing lane combine helper

Files:
- `apps/web/src/lib/laneCombine.ts`
- `apps/web/src/lib/laneCombine.test.ts`

Steps:
1. Add `combineLaneOutputs(mode, results): AudioChannels | null`.
   - `mono`: require `mono`.
   - `left` / `right`: require the matching lane, return one channel.
   - `both`: require both lanes, equal non-zero length, return `[left, right]`.
2. Tests: each mode, missing lane, unequal lengths, empty output, no mutation.
3. Run `pnpm --filter @avalab/web test -- src/lib/laneCombine.test.ts`.

## Task 2 — Sampling lab (F03)

Files:
- `apps/web/src/features/sampling/samplingState.ts`
- `apps/web/src/features/sampling/samplingState.test.ts`
- `apps/web/src/features/sampling/samplingView.tsx`

State:
1. Add `SamplingLaneSettings = { bits; dither }`.
2. Extend `SamplingSettings` with `right?: SamplingLaneSettings` and
   `editLane: "left" | "right"`.
3. Add `samplingLanes(settings)` via `resolveLaneParams`.
4. Encode right overrides as `rrbd`, `rrdt`, plus `el=right`; decode with total
   fallbacks. `seed` stays shared.
5. Tests: round-trip unlinked lanes, old URL stays linked, invalid right fields
   fall back to primary.

View:
1. Add `useChannelMode(original, "both")` and the channel/lane/link controls
   with `sampling.lane.*`, `sampling.linkRight`, `sampling.lane.status` IDs.
2. Derive one result per active lane. Store `{left?, right?, mono?}` and show
   the selected lane charts/metrics under the existing IDs.
3. In both mode, show a per-lane SNR/segmental/PSNR/MSE table
   (`sampling.metrics.lanes`, `sampling.metrics.lane.left/right`).
4. Playback: combine quantized lanes, or errors for residual playback, through
   `setProcessed`. Left/right output is mono.
5. Mono path keeps `sampling.control.*`, `sampling.metric.*`,
   `sampling.result.*`, `sampling.play.*` behavior.
6. Add a short note that rate/anti-alias are shared and locked for both lanes.

## Task 3 — Speed lab (F06)

Files:
- `apps/web/src/features/speed/speedState.ts`
- `apps/web/src/features/speed/speedState.test.ts`
- `apps/web/src/features/speed/speedView.tsx`

State:
1. Add `SpeedLaneSettings = { reverse: boolean }`.
2. Extend `SpeedSettings` with `right?` and `editLane`.
3. Add `speedLanes(settings)`.
4. Encode right reverse as `rrrv`; decode with total fallbacks. Speed, mode,
   and semitones stay shared.
5. Tests: unlinked reverse round-trip, old URL linked, invalid right value
   falls back.

View:
1. Add channel/lane/link controls (`speed.lane.*`, `speed.linkRight`,
   `speed.lane.status`).
2. Derive per active lane with the existing debounce; keep the existing mono
   path and selected-lane spectrogram.
3. Show per-lane duration/actual speed in a table for both mode
   (`speed.result.lanes`, `speed.result.lane.left/right`).
4. Playback combines settled lanes with `combineLaneOutputs`.
5. Theory/observe copy: independent time-stretch lane phase can move the
   stereo image; reverse is per lane.

## Task 4 — Signal-extent lab (F07)

Files:
- `apps/web/src/features/extent/extentState.ts` (URL unchanged)
- `apps/web/src/features/extent/extentView.tsx`

View:
1. Add `useChannelMode(original, "both")` and channel/lane controls
   (`extent.lane.*`); all operation parameters stay shared.
2. Derive per active lane; keep the existing mono path and selected-lane
   before/after spectra.
3. In both mode, show per-lane duration/samples/support/energy/power/type
   (`extent.metrics.lanes`, `extent.metrics.lane.left/right`).
4. Playback combines lanes with `combineLaneOutputs`; left/right output is mono.
5. Add a note that all extent operations use one shared length parameter set.

## Task 5 — Copy, theory, tests, docs, gates

1. Add en/fa keys for channel/lane/shared-grid notes and per-lane tables.
   Persian draft is flagged for owner review in `docs/PROGRESS.md`.
2. Update `theoryContent.ts` for F03/F06/F07 with shared-grid and stereo-image
   caveats.
3. Extend `apps/web/e2e/stereo-processors.spec.ts` with sampling, speed, and
   extent both-mode smoke tests: load stereo demo, process, install playback,
   assert 2 channels channel badge, no console errors.
4. Update `docs/ALGORITHMS.md` with per-lane sampling/speed/extent semantics and
   the grid-changing combine rule.
5. Update `docs/DECISIONS.md` if any behavior differs from the spec.
6. Update `docs/PROGRESS.md`; remove the stale Phase 2 “uncommitted” wording.
7. Update `docs/plans/wave-7/README.md` checkboxes for Phase 3.
8. Gates: `pnpm check`; web build; relevant e2e suites including
   `stereo-processors.spec.ts`, `sampling.spec.ts`, `speed.spec.ts`,
   `extent.spec.ts`; fix all failures before Phase 4.

## Verification matrix

| Concern | Check |
|---|---|
| Mono regression | existing state tests, e2e sampling/speed/extent, unchanged IDs |
| Lane URL | new state round-trip tests, old-link fallback tests |
| Equal grid | combine guard tests, both-mode e2e |
| Playback | both-mode e2e asserts processed + 2-channel badge |
| No main-thread DSP | only worker derives added |
| i18n | `pnpm check` parity gate |
| Docs | ALGORITHMS/DECISIONS/PROGRESS/Wave 7 updated |
