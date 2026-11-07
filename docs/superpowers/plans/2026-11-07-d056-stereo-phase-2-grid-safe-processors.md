# D-056 stereo program — Phase 2: grid-safe processors

> Source spec:
> [`2026-11-07-wave-7-d056-stereo-program-design.md`](../specs/2026-11-07-wave-7-d056-stereo-program-design.md)
> (owner approved 2026-11-07). Parent backlog:
> [`docs/plans/wave-7/README.md`](../../plans/wave-7/README.md).
> Authority: `AGENTS.md`.
>
> No commit, push, merge, or deploy is implied by this plan. The owner gates
> each phase and each commit. `AGENTS.md` overrides the generic “commit every
> task” habit.

## Goal

Add per-lane processing to the three tools whose output grid does not change:

1. **F11 filters** — independent design/apply settings per lane;
2. **F09 spectrum editor** — independent Re/Im edits, masks, curves, and
   Hermitian flags per lane;
3. **F04 toy codecs** — independent codec and MDCT settings per lane, with
   aggregate size/bitrate stats.

Mono stays the default and byte-identical. Old URLs decode to mono/primary.
No worker protocol change, no backend change, no new dependency.

Phase 2 does **not** touch sampling, speed, extent, reverb, pipeline, or
full-file real codecs. Those are Phases 3–6.

## Non-negotiable constraints

- Mono mode must keep the exact existing single-call path, cache keys, test
  IDs, and output bytes. Do not route mono through the stereo combiner when a
  direct path already exists.
- A right-lane override is absent by default. Absent means “mirror the
  primary lane”; it is not an empty/default settings object.
- Old URLs have no right-lane keys and decode to `primary` only.
- Shared fields stay shared: excerpt range, filter `applyScope`, spectrum
  selection/FFT length, and codec excerpt range.
- All DSP stays in the worker. The main thread only slices and combines
  arrays; `combineLaneResults` copies passthrough lanes but runs no DSP.
- Per-lane calls use the existing worker ops through
  `deriveWithSourceLane` / `deriveWithSourceSliceLane`. Mono calls keep
  `deriveWithSource` / `deriveWithSourceSlice`.
- Equal length and equal rate are mandatory before `setProcessed`. A
  mismatch is a translated error, never a trim.
- Unselected lanes are passed through unchanged when a single lane is
  processed; the processed source stays stereo.
- No `any`; TypeScript strict and `noUncheckedIndexedAccess` stay clean.
- `fa` and `en` receive every new key. Plots and numeric readouts stay
  `dir="ltr"` with Latin digits.
- No commit until the owner asks.

## Shared lane rules

### Settings shape

```ts
type LaneParams<T> = {
  readonly primary: T;
  readonly right?: T;
};
```

- `right === undefined` → linked: both lanes resolve to `primary`.
- `right !== undefined` → separate right-lane settings.
- `mono` and `left` use `primary`; `right` uses `right ?? primary`; `both`
  uses `primary` and `right ?? primary`.
- Editing a right-lane control while linked unlinks automatically by copying
  `primary` into `right`, then applying the patch.
- Linking again drops `right`.

### Combining outputs

```ts
combineLaneResults(mode, sourceChannels, startSample, resultLengthSamples, {
  mono?, left?, right?
}): AudioChannels | null
```

- `mono`: `[results.mono]` (today’s downmix result).
- `left`: `[results.left, sourceChannels[1].slice(start, start + length)]`.
- `right`: `[sourceChannels[0].slice(...), results.right]`.
- `both`: `[results.left, results.right]` after an equal-length check.
- Mono source + `left`/`right`: return the processed single channel.
- Missing lane or length mismatch: return `null`; the view shows a translated
  error.
- The helper never mutates the source; it takes ownership of the result
  arrays.

## File map

### Create

- `apps/web/src/lib/laneParams.ts` — `LaneParams`, resolve, link helpers.
- `apps/web/src/lib/laneParams.test.ts` — link/unlink/resolve/immutability.
- `apps/web/src/lib/laneCombine.ts` — `combineLaneResults`.
- `apps/web/src/lib/laneCombine.test.ts` — mono/left/right/both and mismatch.
- `apps/web/src/features/codecLab/codecLabLanes.ts` — aggregate toy-codec
  meta from per-lane metas.
- `apps/web/src/features/codecLab/codecLabLanes.test.ts` — aggregate bytes,
  bitrate, entropy, bit-exactness, empty input.
- `apps/web/e2e/stereo-processors.spec.ts` — filters/spectrum/codec both-mode
  smoke.

### Modify

- `apps/web/src/features/filters/filterState.ts` — pair URL/storage codec.
- `apps/web/src/features/filters/filterState.test.ts` — pair round-trip and
  backward compatibility.
- `apps/web/src/features/filters/filterLabView.tsx` — channel picker, lane
  tabs, linked/right settings, per-lane designs and apply.
- `apps/web/src/features/filters/filterLabView.test.tsx` — optional channel
  controls and right delay readout.
- `apps/web/src/features/spectrumEdit/spectrumEditState.ts` — pair URL/storage
  codec.
- `apps/web/src/features/spectrumEdit/spectrumEditState.test.ts` — pair
  round-trip, right edits, edit lane.
- `apps/web/src/features/spectrumEdit/spectrumEditView.tsx` — lane picker,
  per-lane edits, per-lane derive, combined playback.
- `apps/web/src/features/codecLab/codecLabState.ts` — right-lane override,
  pair URL/storage codec, stale comparison.
- `apps/web/src/features/codecLab/codecLabState.test.ts` — pair round-trip,
  right fallback, stale detection.
- `apps/web/src/features/codecLab/codecLabView.tsx` — channel picker, lane
  tabs, per-lane encode, aggregate stats, combined playback.
- `apps/web/src/features/codecLab/codecLabView.test.tsx` — lane-aware
  psychoacoustic controls.
- `apps/web/src/features/theory/theoryContent.ts` — per-lane notes for the
  three tools.
- `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json` — lane, link,
  aggregate, and stereo-note strings.
- `docs/ALGORITHMS.md` — lane params, combine rules, codec aggregation.
- `docs/DECISIONS.md` — D-056 Phase 2 implementation status.
- `docs/PROGRESS.md` — Phase 2 status and evidence.
- `docs/plans/wave-7/README.md` — link this plan and mark Phase 2.
- `docs/superpowers/specs/2026-11-07-wave-7-d056-stereo-program-design.md` —
  record Phase 2 completion.

## Task 1 — Add shared lane params and output combiner

**Files:** create `apps/web/src/lib/laneParams.ts`,
`apps/web/src/lib/laneParams.test.ts`, `apps/web/src/lib/laneCombine.ts`,
`apps/web/src/lib/laneCombine.test.ts`.

1. Write failing tests first.

   `laneParams.test.ts`:
   - `resolveLaneParams({ primary })` returns the same object for left and
     right.
   - `resolveLaneParams({ primary, right })` keeps them distinct.
   - `laneParamsLinked` is true only when `right` is absent.
   - `unlinkLaneParams` copies primary into right without mutating the input.
   - `relinkLaneParams` drops right and keeps primary.
   - `setPrimaryLane` preserves an existing right override.
   - `setRightLane` adds a right override without touching primary.

   `laneCombine.test.ts`:
   - mono result from a stereo source → one channel, exact result array.
   - left result from a stereo source → `[leftResult, rightPassthrough]`;
     passthrough is a copy, not the source lane buffer.
   - right result → `[leftPassthrough, rightResult]`.
   - both results → `[leftResult, rightResult]`.
   - mono source + left/right → one channel.
   - missing lane, mismatched lengths, out-of-range start, zero length →
     `null`.
   - source lanes are not mutated.

2. Implement `laneParams.ts` exactly:
   ```ts
   export type LaneParams<T> = {
     readonly primary: T;
     readonly right?: T;
   };

   export type ResolvedLaneParams<T> = {
     readonly left: T;
     readonly right: T;
   };

   export function resolveLaneParams<T>(params: LaneParams<T>): ResolvedLaneParams<T>;
   export function laneParamsLinked<T>(params: LaneParams<T>): boolean;
   export function unlinkLaneParams<T>(params: LaneParams<T>): LaneParams<T>;
   export function relinkLaneParams<T>(params: LaneParams<T>): LaneParams<T>;
   export function setPrimaryLane<T>(params: LaneParams<T>, primary: T): LaneParams<T>;
   export function setRightLane<T>(params: LaneParams<T>, right: T): LaneParams<T>;
   ```

3. Implement `laneCombine.ts`:
   ```ts
   import type { AudioChannels } from "@avalab/dsp";
   import type { ChannelMode } from "./channel";

   export type LaneResults = {
     readonly mono?: Float32Array;
     readonly left?: Float32Array;
     readonly right?: Float32Array;
   };

   export function combineLaneResults(
     mode: ChannelMode,
     source: AudioChannels,
     startSample: number,
     resultLengthSamples: number,
     results: LaneResults,
   ): AudioChannels | null;
   ```
   Validate integer start and length before slicing. `startSample +
   resultLengthSamples` must not exceed every source lane used.

4. Run:
   ```bash
   pnpm --filter @avalab/web test -- src/lib/laneParams.test.ts src/lib/laneCombine.test.ts
   pnpm --filter @avalab/web typecheck
   ```

**Acceptance:** both test files pass; no existing file changed.

## Task 2 — Add filter pair state

**Files:** modify `apps/web/src/features/filters/filterState.ts`,
`apps/web/src/features/filters/filterState.test.ts`.

1. Add failing tests:
   - primary-only pair round-trips with no `rr*` keys and `el` absent;
   - right override round-trips with distinct cutoff/kind;
   - old single-lane URL decodes to `{ primary, editLane: "left" }` with no
     right;
   - primary ripple `rp` still decodes; it is not mistaken for a right key;
   - right cutoff above Nyquist clamps independently;
   - pair storage round-trips; an old stored single-lane string loads with no
     right;
   - `filterPairAtRate` re-clamps both lanes at the source rate.
2. Add:
   ```ts
   export type FilterEditLane = "left" | "right";

   export type FilterPairSettings = LaneParams<FilterSettings> & {
     readonly editLane: FilterEditLane;
   };

   export function filterPairToSearch(pair: FilterPairSettings): string;
   export function filterPairFromSearch(search: string): FilterPairSettings;
   export function filterPairAtRate(
     pair: FilterPairSettings,
     sampleRateHz: number,
   ): FilterPairSettings;
   export function loadFilterPair(
     storage?: FilterStorage | null,
   ): FilterPairSettings;
   export function saveFilterPair(
     pair: FilterPairSettings,
     storage?: FilterStorage | null,
   ): void;
   ```
   Use right-key prefix `rr`: `rrk`, `rrbd`, `rrc`, `rrc2`, `rro`, `rrt`,
   `rrw`, `rrrp`, `rrq`, `rrg`, `rrsr`, `rras`. `el=right` is emitted only
   for a right edit lane. Detect a right override only when a key starts with
   `rr` and has length > 2. Reuse `filterSettingsToSearch` /
   `filterSettingsFromSearch` by stripping/adding the prefix.
3. Keep `filterSettingsToSearch` and `filterSettingsFromSearch` as the
   single-lane codec used by the pair functions and existing tests.
4. Run:
   ```bash
   pnpm --filter @avalab/web test -- src/features/filters/filterState.test.ts
   pnpm --filter @avalab/web typecheck
   ```

**Acceptance:** old single-lane storage and URLs still decode; right
overrides are independent.

## Task 3 — Wire filters to lanes

**Files:** modify `apps/web/src/features/filters/filterLabView.tsx`,
`apps/web/src/features/filters/filterLabView.test.tsx`;
`apps/web/src/features/theory/theoryContent.ts`;
`apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`.

1. Import `useChannelMode` and `ChannelPicker`; call
   `useChannelMode(original, "both")`.
2. Replace single settings state with the pair:
   - empty search → `loadFilterPair()`;
   - non-empty search → `filterPairFromSearch(...)`;
   - source loaded → `filterPairAtRate(pair, original.sampleRateHz)`.
   - persist with `saveFilterPair`.
3. Effective edit lane:
   - `mono` → `"left"` (primary);
   - `left` → `"left"`;
   - `right` → `"right"`;
   - `both` → `pair.editLane`.
4. Resolve lanes with `resolveLaneParams(pair)`. `updateLane(patch)` updates
   the effective lane. Editing the right lane while linked creates
   `right = { ...primary, ...patch }`. Editing the left lane while linked
   leaves `right` absent.
5. Add controls above the existing panel grid:
   - `ChannelPicker` with test ID from the shared component;
   - in `both` only: lane buttons `filters.lane.left` and
     `filters.lane.right`;
   - a checkbox `filters.linkRight`, checked when linked;
   - a link status line `filters.lane.linked` / `filters.lane.separate`.
6. URL updates must delete every old `rr*` key and `el` before writing the
   next pair, so relinking does not leave a stale right override.
7. Derive designs for every lane the current mode will apply:
   - mono/left/right: one design for the effective lane;
   - both: left and right designs (reuse the left design when linked).
   Keep per-lane validity and a single translated design error.
8. Apply per lane:
   - `mono`: keep the existing `original.samples.slice(...)` path and
     `setProcessed(outcome.samples, ...)` exactly;
   - `left`/`right`: apply to `original.channels[0]` or `[1]`, pass the other
     channel through;
   - `both`: apply both lanes in parallel, each with its own settings/design.
   Build `LaneResults` keyed `mono`/`left`/`right`, call
   `combineLaneResults(mode, original.channels, start, resultLength, results)`,
   and install the returned channels.
9. `FilterAppliedRange` gains `rightDelaySamples?: number`. Render the right
   delay only when the right lane was processed. Use
   `filters.result.delayRight`.
10. Export `filtered.channels` instead of `filtered.samples` so stereo WAVs
    keep both lanes.
11. Add English/Persian keys:
    ```json
    "filters": {
      "lane": {
        "left": "Left lane",
        "right": "Right lane",
        "link": "Use the same settings for both lanes",
        "linked": "Right lane mirrors the left lane.",
        "separate": "Right lane has separate settings."
      },
      "result": { "delayRight": "Right delay" }
    }
    ```
    Persian:
    ```json
    "filters": {
      "lane": {
        "left": "کانال چپ",
        "right": "کانال راست",
        "link": "تنظیمات یکسان برای هر دو کانال",
        "linked": "کانال راست از کانال چپ پیروی می‌کند.",
        "separate": "کانال راست تنظیمات جداگانه دارد."
      },
      "result": { "delayRight": "تأخیر راست" }
    }
    ```
12. Extend the filters theory section: independent L/R design is educational,
    but linked mode shows the same filter on both lanes; the response and
    pole-zero plots show the selected lane.
13. Panel API stays backward compatible: add optional `channelControls?:
    React.ReactNode` and `rightDelaySamples?: number`. Update panel tests to
    cover the optional controls and right delay.
14. Run:
    ```bash
    pnpm --filter @avalab/web test -- src/features/filters
    pnpm --filter @avalab/web typecheck
    ```

**Acceptance:** mono apply path unchanged; stereo left/right/both apply
returns two channels; old filter URLs still open in mono.

## Task 4 — Add spectrum pair state

**Files:** modify `apps/web/src/features/spectrumEdit/spectrumEditState.ts`,
`apps/web/src/features/spectrumEdit/spectrumEditState.test.ts`.

1. Add failing tests:
   - primary-only pair round-trips with no `rr*` keys;
   - independent right `hermitian`, `edits`, and curves round-trip;
   - `el=right` survives a share URL and defaults to left;
   - old single-lane URL decodes with no right and `editLane: "left"`;
   - invalid right edits are dropped alone;
   - pair storage round-trips and an old stored string loads primary-only.
2. Add:
   ```ts
   export type SpectrumEditLaneSettings = Pick<
     SpectrumEditSettings,
     "hermitian" | "edits" | "curves"
   >;

   export type SpectrumEditPairSettings = {
     readonly lanes: LaneParams<SpectrumEditLaneSettings>;
     readonly startSample: number;
     readonly endSample: number;
     readonly editLane: "left" | "right";
   };

   export function spectrumEditPairToSearch(
     settings: SpectrumEditPairSettings,
   ): string;
   export function spectrumEditPairFromSearch(
     search: string,
     source: SpectrumEditSourceInfo,
     selection: SpectrumEditRange,
   ): SpectrumEditPairSettings;
   export function loadSpectrumEditPair(
     source: SpectrumEditSourceInfo,
     selection: SpectrumEditRange,
     storage?: LastUsedStorage | null,
   ): SpectrumEditPairSettings;
   export function saveSpectrumEditPair(
     settings: SpectrumEditPairSettings,
     storage?: LastUsedStorage | null,
   ): void;
   ```
   Primary keys stay `h`, `ed`, and the existing curve key. Right keys use
   prefix `rr` (`rrh`, `rred`, `rrcv`). `from`/`to` stay shared. Detect right
   only when an `rr*` key with length > 2 exists. Decode right edits/curves
   with the same `maxBin` as primary.
3. Keep the existing single-lane codec functions for tests and as helpers.
4. Run:
   ```bash
   pnpm --filter @avalab/web test -- src/features/spectrumEdit/spectrumEditState.test.ts
   pnpm --filter @avalab/web typecheck
   ```

**Acceptance:** old spectrum-edit URLs decode to primary-only; right edits
cannot leak into the primary lane.

## Task 5 — Wire spectrum editor to lanes

**Files:** modify
`apps/web/src/features/spectrumEdit/spectrumEditView.tsx`;
`apps/web/src/features/theory/theoryContent.ts`;
`apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`.

1. Add `useChannelMode(original, "both")` with `ChannelPicker`.
2. Replace settings with the pair codec. Shared `startSample` /
   `endSample` remain pair-level.
3. Effective edit lane follows the same rule as filters. Resolve lanes with
   `resolveLaneParams`.
4. Derive the displayed frame for the effective lane:
   - `mono`: keep `deriveWithSourceSlice("spectrumEdit", ...)` exactly;
   - `left`/`right`: `deriveWithSourceSliceLane(..., laneIndex)`;
   - `both`: use the edit lane’s index.
   Display `spectrumEdit.meta.channel` with the lane label.
5. Editing right while linked copies primary lane settings into right first.
   Link/unlink controls:
   - lane buttons `spectrumEdit.lane.left` / `spectrumEdit.lane.right`;
   - checkbox `spectrumEdit.linkRight`;
   - status `spectrumEdit.lane.linked` / `spectrumEdit.lane.separate`.
6. Hermitian, edit list, presets, and curves all read/write the effective
   lane. To apply a preset to both lanes, keep the lanes linked (or apply it
   twice).
7. Playback:
   - `mono`: keep the existing direct `setProcessed(result.samples, ...)`;
   - `left`/`right`: combine the processed lane with the passthrough lane via
     `combineLaneResults`;
   - `both`: run both lanes with their own settings (`deriveWithSourceSliceLane`
     for each), then combine. Use `result.meta.sampleCount` as the shared
     result length and reject a mismatch.
8. URL updates must delete old `rr*` and `el` keys before writing the next
   pair.
9. Add keys:
   ```json
   "spectrumEdit": {
     "lane": {
       "left": "Left lane",
       "right": "Right lane",
       "link": "Use the same edits for both lanes",
       "linked": "Edits apply to both lanes.",
       "separate": "Edits apply to the selected lane only."
     },
     "meta": { "channel": "Channel" }
   }
   ```
   Persian:
   ```json
   "spectrumEdit": {
     "lane": {
       "left": "کانال چپ",
       "right": "کانال راست",
       "link": "ویرایش یکسان برای هر دو کانال",
       "linked": "ویرایش‌ها روی هر دو کانال اعمال می‌شوند.",
       "separate": "ویرایش‌ها فقط روی کانال انتخاب‌شده اعمال می‌شوند."
     },
     "meta": { "channel": "کانال" }
   }
   ```
10. Extend the spectrum-editor theory: Hermitian symmetry is per lane;
    independent editing can break the original stereo relationship.
11. Run:
    ```bash
    pnpm --filter @avalab/web test -- src/features/spectrumEdit
    pnpm --filter @avalab/web typecheck
    ```

**Acceptance:** mono playback and URL behavior unchanged; stereo both mode
plays two independently edited lanes; mismatched lengths show an error.

## Task 6 — Add codec lane state and aggregate stats

**Files:** modify `apps/web/src/features/codecLab/codecLabState.ts`,
`apps/web/src/features/codecLab/codecLabState.test.ts`; create
`apps/web/src/features/codecLab/codecLabLanes.ts`,
`apps/web/src/features/codecLab/codecLabLanes.test.ts`.

1. Split the toy fields into `CodecLabLaneSettings`:
   ```ts
   export type CodecLabLaneSettings = {
     readonly codec: CodecLabCodec;
     readonly mdctBitsPerSecond: number;
     readonly mdctPsychoacoustic: boolean;
     readonly mdctReferenceSplDb: number;
   };

   export type CodecLabSettings = CodecLabLaneSettings & {
     readonly startSample: number;
     readonly endSample: number;
     readonly realCodec: RealCodecName;
     readonly realBitrateKbps: number;
     readonly realQuality: number;
     readonly realCompressionLevel: number;
     readonly right?: CodecLabLaneSettings;
     readonly editLane: "left" | "right";
   };
   ```
   Update `CODEC_LAB_DEFAULT_SETTINGS` with `editLane: "left"`.
2. Add failing state tests:
   - primary-only settings round-trip with no `rr*` keys;
   - independent right codec/bitrate/psycho/SPL round-trip;
   - right fields fall back to the primary lane when partially present;
   - old URL decodes with no right and `editLane: "left"`;
   - changing only the right codec marks the toy result stale;
   - real-codec staleness ignores right toy settings.
3. URL: primary keys `c`, `mbr`, `pm`, `rspl` unchanged. Right keys
   `rrc`, `rrmbr`, `rrpm`, `rrrspl`. `el=right` only when the edit lane is
   right. `from`/`to` and real-codec keys stay shared.
4. Add:
   ```ts
   export function codecLabLanes(
     settings: CodecLabSettings,
   ): ResolvedLaneParams<CodecLabLaneSettings>;

   export function codecLabLaneFor(
     settings: CodecLabSettings,
     lane: "left" | "right",
   ): CodecLabLaneSettings;
   ```
5. Create `codecLabLanes.ts` with:
   ```ts
   export type CodecLabAggregate = {
     sampleCount: number;
     originalBytes: number;
     compressedSizeBytes: number;
     bitsPerSample: number;
     bitrateKbps: number;
     compressionRatio: number;
     entropyBitsPerSymbol: number;
     encodeMs: number;
     decodeMs: number;
     bitExact: boolean;
   };

   export function aggregateCodecLanes(
     metas: readonly CodecLabMeta[],
   ): CodecLabAggregate | null;
   ```
   Rules: sum `originalBytes`, `compressedSizeBytes`, `encodeMs`, `decodeMs`,
   `bitrateKbps`, and `sampleCount`; ratio = total original / total
   compressed; bits/sample = total compressed bits / total samples;
   `bitExact` = every lane exact; entropy = Shannon entropy of the summed
   byte histograms (not an average of per-lane entropies). Empty input →
   `null`.
6. Tests: two fake metas with different histograms; bit-exact false when one
   lane false; empty input null; finite values for zero compressed bytes
   (ratio Infinity, bits 0).
7. Run:
   ```bash
   pnpm --filter @avalab/web test -- src/features/codecLab/codecLabState.test.ts src/features/codecLab/codecLabLanes.test.ts
   pnpm --filter @avalab/web typecheck
   ```

**Acceptance:** old codec-lab URLs decode to mono/primary; aggregate numbers
are derived from measured lane metas, never from requested presets.

## Task 7 — Wire toy codecs to lanes

**Files:** modify `apps/web/src/features/codecLab/codecLabView.tsx`,
`apps/web/src/features/codecLab/codecLabView.test.tsx`;
`apps/web/src/features/theory/theoryContent.ts`;
`apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`.

1. Add `useChannelMode(original, "both")` with `ChannelPicker`.
2. `CodecLabPsychoControls` takes `CodecLabLaneSettings` instead of the full
   settings; update its tests.
3. Resolve lanes with `codecLabLanes`. Effective edit lane follows the same
   rule as filters. Toy controls read/write the effective lane:
   - codec select;
   - MDCT bitrate;
   - psychoacoustic checkbox;
   - reference SPL.
   Editing right while linked copies primary first. Add lane buttons
   `codecLab.lane.left` / `codecLab.lane.right`, checkbox
   `codecLab.linkRight`, and status `codecLab.lane.linked` /
   `codecLab.lane.separate`.
4. Excerpt controls and real-codec controls stay shared.
5. Encode:
   - `mono`: keep the existing `deriveWithSourceSlice` call and result shape
     exactly;
   - `left`/`right`: call `deriveWithSourceSliceLane` with the lane settings;
   - `both`: run both lanes, each with its own settings.
   Store:
   ```ts
   type LaneCodecResult = {
     readonly id: "mono" | "left" | "right";
     readonly meta: CodecLabMeta;
     readonly samples: Float32Array;
   };

   type CodecLabViewResult = {
     readonly perLane: readonly LaneCodecResult[];
     readonly playback: AudioChannels;
     readonly settings: CodecLabSettings;
     readonly mode: ChannelMode;
   };
   ```
   Build `playback` with `combineLaneResults`. Reject a length mismatch with
   `codecLab.error.failed`.
6. Stats:
   - one lane: keep the existing stats rows and MDCT/histogram/table;
   - two lanes: show `aggregateCodecLanes(metas)` under
     `codecLab.stats.aggregate`, plus a per-lane metrics table for MSE/SNR/
     segmental SNR/PSNR. Never average segmental SNR.
   - diagnostics (MDCT bands, histogram, code lengths) show the effective
     edit lane; label it with `codecLab.stats.lane.left/right`.
7. Comparison table: keep single-lane rows unchanged. In both mode, show
   `codecLab.comparison.stereoNote` and do not fabricate a mixed-codec row.
   Batch comparison remains the existing mono-downmix run.
8. Playback installs `result.playback` via `setProcessed`. Mono output is
   still one channel.
9. Add keys:
   ```json
   "codecLab": {
     "lane": {
       "left": "Left lane",
       "right": "Right lane",
       "link": "Use the same codec settings for both lanes",
       "linked": "Right lane mirrors the left lane.",
       "separate": "Right lane has separate settings."
     },
     "toy": {
       "lane": "This result processes the selected lane; the other lane is passed through.",
       "stereo": "Each lane is encoded and decoded independently; stats aggregate both lanes."
     },
     "stats": {
       "aggregate": "Both lanes",
       "lane": { "left": "Left lane", "right": "Right lane" }
     },
     "comparison": {
       "stereoNote": "Switch to Mono, Left, or Right to add a single-lane comparison row."
     }
   }
   ```
   Persian:
   ```json
   "codecLab": {
     "lane": {
       "left": "کانال چپ",
       "right": "کانال راست",
       "link": "تنظیمات یکسان کدک برای هر دو کانال",
       "linked": "کانال راست از کانال چپ پیروی می‌کند.",
       "separate": "کانال راست تنظیمات جداگانه دارد."
     },
     "toy": {
       "lane": "این نتیجه فقط کانال انتخاب‌شده را پردازش می‌کند؛ کانال دیگر بدون تغییر می‌ماند.",
       "stereo": "هر کانال جداگانه کدگذاری و کدگشایی می‌شود؛ آمار هر دو کانال جمع می‌شود."
     },
     "stats": {
       "aggregate": "هر دو کانال",
       "lane": { "left": "کانال چپ", "right": "کانال راست" }
     },
     "comparison": {
       "stereoNote": "برای افزودن ردیف مقایسه تک‌کاناله، حالت مونو، چپ یا راست را انتخاب کنید."
     }
   }
   ```
10. Replace the `codecLab.toy.mono` note: keep it for mono, use
    `codecLab.toy.lane` for left/right and `codecLab.toy.stereo` for both.
11. Extend the codec theory: independent lane coding is a teaching
    simplification; real MP3/AAC joint-stereo tools are out of scope here.
12. Run:
    ```bash
    pnpm --filter @avalab/web test -- src/features/codecLab
    pnpm --filter @avalab/web typecheck
    ```

**Acceptance:** mono toy results are byte-identical; stereo both mode
aggregates size/bitrate honestly; no mixed-codec comparison row is invented.

## Task 8 — Add stereo e2e, docs, and final gates

**Files:** create `apps/web/e2e/stereo-processors.spec.ts`; modify
`docs/ALGORITHMS.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md`,
`docs/plans/wave-7/README.md`, and the program spec.

1. Add Playwright smoke tests using the bundled stereo demo:
   - `filters`: `/tools/filters?ch=both`, load stereo, link checkbox checked,
     apply selection, expect `filters.apply.done`, no console errors.
   - `spectrumEdit`: `/tools/spectrumEdit?ch=both`, load stereo, lane buttons
     visible, apply `zeroIm` preset, play, no console errors.
   - `codecLab`: `/tools/codecLab?ch=both`, load stereo, encode RLE, expect
     aggregate stats and play, no console errors.
   Use the existing `watchForErrors` pattern.
2. Update `docs/ALGORITHMS.md`:
   - `LaneParams` resolve/link rules;
   - `combineLaneResults` lane order and length guard;
   - codec aggregate rules, including histogram entropy.
3. Update `docs/DECISIONS.md` D-056 status:
   `Phase 2 (grid-safe processors) implemented on 2026-11-07`.
4. Update `docs/PROGRESS.md` with:
   - files and tools changed;
   - tests run and counts;
   - known limits: no joint-stereo, no both-lane comparison row, batch
     comparison stays mono;
   - items needing owner review (Persian copy, stereo listening).
5. Update `docs/plans/wave-7/README.md` link and status.
6. Mark the program spec:
   `**Status:** approved design; Phase 1 implemented; Phase 2 implemented`.
7. Run:
   ```bash
   pnpm --filter @avalab/web test -- src/features/filters src/features/spectrumEdit src/features/codecLab
   pnpm --filter @avalab/web typecheck
   pnpm --filter @avalab/web build
   pnpm --filter @avalab/web exec playwright test e2e/stereo-processors.spec.ts
   pnpm check
   ```
   `pnpm check` must pass: Biome, both typechecks, all unit tests, scripts
   tests, and the i18n key check.
8. Validate edited JSON before finishing:
   ```bash
   node -e "JSON.parse(require('node:fs').readFileSync('apps/web/src/i18n/en.json','utf8'))"
   node -e "JSON.parse(require('node:fs').readFileSync('apps/web/src/i18n/fa.json','utf8'))"
   ```
9. Do not commit. Report the diff, test evidence, and the next phase
   (grid-changing tools) to the owner.

**Acceptance:** `pnpm check` passes; the new e2e spec passes 3/3; mono
regression tests pass; docs match the implementation.

## Definition of Done

- Filters, spectrum editor, and toy codecs support mono/left/right/both.
- Right-lane settings are optional and mirror primary when absent.
- Old URLs and storage decode to mono/primary.
- Mono outputs and cache keys are unchanged.
- Stereo outputs preserve unselected lanes and stay rate/length aligned.
- All new strings exist in `en.json` and `fa.json`; Persian is flagged for
  human review.
- `pnpm check` and the new e2e spec pass in this session.
- `docs/PROGRESS.md`, `docs/DECISIONS.md`, `docs/ALGORITHMS.md`, and the
  Wave 7 plan/spec status are updated.
- No commit or push unless the owner asks.
