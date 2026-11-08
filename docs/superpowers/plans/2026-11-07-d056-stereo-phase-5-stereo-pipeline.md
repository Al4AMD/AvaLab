# D-056 Phase 5 — Stereo pipeline

**Goal:** F15 runs the same validated graph on each selected lane, combines
corresponding outputs only when rate and length match, and reports per-lane
output stats. No per-node channel overrides; the pipeline URL schema is
unchanged.

## Steps

1. Extend `usePipelineRun(state, range, channelMode)`:
   - mono keeps `deriveWithSourceSlice`;
   - left/right use `deriveWithSourceSliceLane` on that lane;
   - both dispatch one lane ticket per channel and settle with `Promise.all`.
2. Reject mismatched lane grids (`gridMismatch`) before exposing a result.
3. Install selected output as two processed lanes in both mode; keep mono and
   solo-lane behavior otherwise.
4. Add `ChannelPicker` to the pipeline view and a per-lane output stats table.
5. Add `pipeline.lane.*`, `pipeline.error.gridMismatch`, and pipeline theory
   stereo copy in both locales.
6. Cover the both-lane flow in `e2e/stereo-processors.spec.ts`.

## Verification

`pnpm check`, web build, `pipeline.spec.ts` + `stereo-processors.spec.ts`.

## Status

Done 2026-11-07. No commit (owner gate).
