# D-056 stereo program — Phase 1: channel foundation and analysis

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

Make one channel model available to analysis tools:

1. `mono` (default; the existing mean downmix) is byte-identical to today;
2. `left` and `right` analyse one playback channel;
3. `both` stacks the two waveform lanes and is rejected by single-panel tools;
4. waveform, spectrogram, FFT, and metrics read the selected lane;
5. the selected channel is shareable in the URL (`ch=left|right|both`);
6. no backend change, no worker protocol change, no new dependency.

Phase 1 does **not** add per-lane processing parameters. `LaneParams<T>` and
independent L/R tool controls start in Phase 2 with the first field that needs
them.

## Non-negotiable constraints

- Mono source layout stays `samples === channels[0]`; stereo `samples` stays
  the mean downmix from F01.
- Every existing mono cache key, readout, and test ID stays unchanged.
- All DSP stays in the worker. Views only choose a lane and pass buffers
  through the store.
- `both` is valid for waveform and metrics only. Spectrogram and FFT expose
  `mono`, `left`, `right` only.
- A processed result that lacks the selected lane must show a translated
  mismatch message; never compare a mono result against one stereo lane.
- `fa` and `en` receive every new key. Technical plots and numeric readouts
  stay `dir="ltr"` with Latin digits.
- No `any`; TypeScript strict and `noUncheckedIndexedAccess` stay clean.
- No commit until the owner asks.

## File map

### Create

- `apps/web/src/lib/channel.ts` — pure channel mode, lane, signal, and URL
  helpers.
- `apps/web/src/lib/channel.test.ts` — mono/stereo mode lists, signal choice,
  URL parsing.
- `apps/web/src/features/channels/useChannelMode.ts` — URL-backed channel mode
  hook.
- `apps/web/src/features/channels/ChannelPicker.tsx` — shared segmented
  control.
- `apps/web/src/features/channels/ChannelPicker.test.tsx` — rendered options
  and pressed state.
- `apps/web/src/session/store.lane.test.ts` — lane payload, cache-key, and
  rejection tests.
- `apps/web/src/features/metrics/metricsLanes.ts` — pure selection of
  reference/test lane pairs and mismatch classification.
- `apps/web/src/features/metrics/metricsLanes.test.ts` — mono, left, right,
  both, missing lane tests.
- `apps/web/e2e/channel-analysis.spec.ts` — stereo demo through waveform,
  spectrogram, and FFT.

### Modify

- `apps/web/src/session/store.ts` — `deriveWithSourceLane`,
  `deriveWithSourceSliceLane`, lane-aware cache suffix.
- `apps/web/src/features/waveform/waveformView.tsx` — mono/left/right/both
  overview and detail lanes.
- `apps/web/src/features/spectrogram/workerJob.ts` — lane-aware chunk derive.
- `apps/web/src/features/spectrogram/spectrogramView.tsx` — channel picker and
  lane meta.
- `apps/web/src/features/fftview/fftView.tsx` — lane-aware FFT and picker.
- `apps/web/src/features/metrics/metricsView.tsx` — per-lane metric panels.
- `apps/web/src/features/theory/theoryContent.ts` — shared channel theory
  section for waveform, spectrogram, FFT, metrics.
- `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json` — channel labels,
  notes, lane labels, mismatch message, theory section.
- `docs/PROGRESS.md` — Phase 1 status and verification evidence.
- `docs/DECISIONS.md` — D-056 implementation status and channel model.
- `docs/ALGORITHMS.md` — lane-selection and cache-key rule.
- `docs/plans/wave-7/README.md` — link this plan and mark Phase 1.
- `docs/superpowers/specs/2026-11-07-wave-7-d056-stereo-program-design.md` —
  mark approved and record Phase 1 completion.

## Task 1 — Add pure channel helpers

**Files:** create `apps/web/src/lib/channel.ts`,
`apps/web/src/lib/channel.test.ts`.

1. Write failing tests first:
   ```ts
   import type { AudioChannels } from "@avalab/dsp";
   import {
     availableChannelModes,
     channelModeFromSearch,
     channelModeToSearch,
     channelSignals,
     displayedLanes,
     laneIndexForSingleMode,
   } from "./channel";
   ```
   Cases:
   - mono source + `"both"` support exposes `["mono"]`;
   - stereo source + `"single"` exposes `["mono", "left", "right"]`;
   - stereo source + `"both"` exposes `["mono", "left", "right", "both"]`;
   - `channelSignals` returns `[samples]` for mono, `[channels[0]]` for left,
     `[channels[1]]` for right, `[channels[0], channels[1]]` for both;
   - a mono source with `right` falls back to its only lane (guard, not a
     user-reachable state);
   - `displayedLanes("both")` returns left then right; other modes return one
     lane;
   - `laneIndexForSingleMode("left") === 0`, `"right" === 1`,
     `"mono" === 0`, `"both" === null`;
   - `channelModeFromSearch(new URLSearchParams("ch=right")) === "right"`;
   - missing or invalid `ch` falls back to `"mono"`;
   - `channelModeToSearch("mono") === null`; other values return the mode.
2. Run:
   ```bash
   pnpm --filter @avalab/web test -- src/lib/channel.test.ts
   ```
   Expected: fail because the module does not exist.
3. Implement `apps/web/src/lib/channel.ts`:
   ```ts
   import type { AudioChannels } from "@avalab/dsp";

   export const CHANNEL_QUERY_KEY = "ch";
   export const CHANNEL_MODES = ["mono", "left", "right", "both"] as const;
   export type ChannelMode = (typeof CHANNEL_MODES)[number];
   export type LaneIndex = 0 | 1;
   export type ChannelLaneId = "mono" | "left" | "right";
   export type ChannelToolSupport = "single" | "both";

   export type ChannelSource = {
     readonly samples: Float32Array;
     readonly channels: AudioChannels;
   };

   export type DisplayedLane = {
     readonly id: ChannelLaneId;
     readonly lane: LaneIndex;
   };
   ```
   Implement the tested functions with no React and no store import.
   `channelSignals` must never mutate or copy the lane buffers.
4. Run the test again; then run `pnpm --filter @avalab/web typecheck`.

**Acceptance:** tests pass; no existing file changed.

## Task 2 — Add lane-aware store derives

**Files:** modify `apps/web/src/session/store.ts`; create
`apps/web/src/session/store.lane.test.ts`.

1. Write failing tests in a new file using `makeFakeTransport` and
   `createDspRpc` exactly like `store.test.ts`:
   - load a 2-channel source with distinct left/right values;
   - `deriveWithSourceLane("waveformOverview", WAVEFORM_PARAMS, 1)` sends the
     RIGHT channel bytes, not the downmix and not the left channel;
   - the request payload buffer is a copy; the session lane buffer is not
     detached;
   - lane 1 key has four NUL-separated parts and ends with the lane marker;
   - the same params on lane 0 and lane 1 produce different keys;
   - lane 1 cache hit sends no second frame;
   - `deriveWithSourceSliceLane(..., 2, 5, 1)` sends only
     `right[2..5]` and clamps out-of-range slices;
   - no source rejects `{code: "noSource"}` with no RPC frame;
   - a mono source with lane 1 rejects `{code: "noLane"}` with no RPC frame.
2. Run:
   ```bash
   pnpm --filter @avalab/web test -- src/session/store.lane.test.ts
   ```
   Expected: fail because the methods do not exist.
3. Extend `SessionStore`:
   ```ts
   deriveWithSourceLane<K extends DspOpName>(
     opKey: K,
     params: DspOpParams<K>,
     lane: LaneIndex,
   ): DeriveTicket<K>;

   deriveWithSourceSliceLane<K extends DspOpName>(
     opKey: K,
     params: DspOpParams<K>,
     startSample: number,
     endSample: number,
     lane: LaneIndex,
   ): DeriveTicket<K>;
   ```
   Import `type LaneIndex` from `../lib/channel`.
4. Extend `openDerivedJob` with an optional key suffix:
   ```ts
   keySuffix = ""
   const key = `${opKey}\u0000${canonical}\u0000${inputHash}${keySuffix}`;
   ```
   Existing mono derives pass no suffix and keep their exact three-part keys.
   Lane derives pass `\u0000lane:${lane}`.
5. Implement both methods:
   - resolve `const samples = original.channels[lane]`;
   - missing lane returns a rejected ticket with code `noLane`, `key: ""`,
     and an attached no-op catch so the store side is not noisy;
   - full derive slices `samples.slice()`;
   - slice derive clamps against `samples.length` and slices that lane;
   - params are pinned by the caller as today; the lane suffix is part of the
     cache key.
6. Run the new test, `store.test.ts`, and
   `store.slice.test.ts`; then typecheck.

**Acceptance:** lane results are distinct and stable; every existing mono
store test still passes.

## Task 3 — Add the shared picker and URL hook

**Files:** create `apps/web/src/features/channels/useChannelMode.ts`,
`apps/web/src/features/channels/ChannelPicker.tsx`,
`apps/web/src/features/channels/ChannelPicker.test.tsx`; modify
`apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`,
`apps/web/src/features/theory/theoryContent.ts`.

1. Add English keys:
   ```json
   "channel": {
     "label": "Channel",
     "mono": "Mono (downmix)",
     "left": "Left channel",
     "right": "Right channel",
     "both": "Both channels",
     "note": "Mono analyses the two-channel downmix. Left and Right analyse one playback channel.",
     "theory": {
       "heading": "Stereo and the analysis lane",
       "body": "The player keeps both channels. Analysis tools can use mono (the mean of both channels), the left channel, or the right channel. Mono is an analysis choice, not a stereo mix; use Left and Right when the channels differ."
     }
   }
   ```
   Add natural Persian equivalents with the same structure:
   ```json
   "channel": {
     "label": "کانال",
     "mono": "مونو (میانگین دو کانال)",
     "left": "کانال چپ",
     "right": "کانال راست",
     "both": "هر دو کانال",
     "note": "تحلیل مونو روی میانگین دو کانال انجام می‌شود. چپ و راست فقط کانال انتخاب‌شده را تحلیل می‌کنند.",
     "theory": {
       "heading": "استریو و کانال تحلیل",
       "body": "پخش‌کننده هر دو کانال را نگه می‌دارد. ابزارهای تحلیل می‌توانند از مونو (میانگین دو کانال)، کانال چپ یا کانال راست استفاده کنند. مونو یک انتخاب تحلیلی است، نه ترکیب استریو؛ وقتی دو کانال متفاوت‌اند از چپ و راست استفاده کنید."
     }
   }
   ```
2. Add the shared theory section to `waveform`, `spectrogram`, `fftview`, and
   `metrics` in `TOOL_THEORY`:
   ```ts
   {
     headingKey: "channel.theory.heading",
     bodyKey: "channel.theory.body",
   }
   ```
   Place it last in each list so existing formulas and sections stay first.
3. Implement `useChannelMode(source, support)`:
   - `source: ChannelSource | null`;
   - `support: ChannelToolSupport`;
   - `modes` is memoized from `availableChannelModes(source, support)`;
   - reads `channelModeFromSearch(searchParams)`;
   - returns the requested mode when allowed, otherwise `"mono"`;
   - `setMode(next)` is a no-op for an unavailable mode; otherwise clones the
     current `URLSearchParams`, deletes `ch` for mono, sets it for others, and
     calls `setSearchParams(..., { replace: true })`.
4. Implement `ChannelPicker` with props
   ```ts
   {
     mode: ChannelMode;
     modes: readonly ChannelMode[];
     onChange: (mode: ChannelMode) => void;
   }
   ```
   - return `null` when fewer than two modes are available;
   - render a `fieldset` with legend `t("channel.label")`;
   - one button per mode with `data-testid={"channel.mode." + mode}`,
     `aria-pressed`, and the translated label;
   - show `t("channel.note")` once below the buttons.
5. Test with `renderToStaticMarkup`:
   - mono mode only renders one option;
   - stereo `single` renders mono/left/right and marks right pressed;
   - `both` renders four options;
   - no number or technical readout is inside a `dir`-sensitive wrapper.
6. Run:
   ```bash
   pnpm --filter @avalab/web test -- src/features/channels/ChannelPicker.test.tsx
   pnpm i18n:check
   pnpm --filter @avalab/web typecheck
   ```

**Acceptance:** keys exist in both locales; picker renders translated labels
in both languages; URL hook has no effect-loop.

## Task 4 — Make waveform lane-aware

**Files:** modify `apps/web/src/features/waveform/waveformView.tsx`.

1. Change the two hooks:
   - `useOverview(lane: LaneIndex)` calls
     `deriveWithSourceLane("waveformOverview", params, lane)`;
   - `useSliceEnvelope(original, lane, window, skip)` calls
     `deriveWithSourceSliceLane("waveformRange", params, start, end, lane)`.
2. Read the mode once:
   ```ts
   const { mode, modes, setMode } = useChannelMode(original, "both");
   const lanes = displayedLanes(mode);
   ```
3. Extract a child component `WaveformLanePanel` in the same file. It owns the
   overview/detail hooks and renders:
   - an overview `WaveformCanvas`;
   - zoom/pan controls are **not** duplicated per lane; keep one control row;
   - detail canvases for each displayed lane, with the same selection and drag
     handlers;
   - labels from `channel.mono`, `channel.left`, or `channel.right`.
4. Preserve existing test IDs:
   - mono, left, and right single-mode first lane use
     `waveform.overview.canvas` and `waveform.detail.canvas`;
   - `both` uses the base IDs for left and `waveform.overview.canvas.right` /
     `waveform.detail.canvas.right` for right;
   - add `data-testid="waveform.lane.<id>"` on each lane caption.
5. Peak readout: compute the maximum absolute envelope value across the
   displayed lanes. Keep the existing readout keys and LTR formatting.
6. Place `<ChannelPicker mode={mode} modes={modes} onChange={setMode} />`
   beside the existing readout, before the overview. Add no tool-specific
   channel state.
7. Run:
   ```bash
   pnpm --filter @avalab/web test
   pnpm --filter @avalab/web typecheck
   ```

**Acceptance:** mono DOM and test IDs unchanged; stereo `both` paints two
lanes; left/right paint one selected lane.

## Task 5 — Make spectrogram lane-aware

**Files:** modify `apps/web/src/features/spectrogram/workerJob.ts`,
`apps/web/src/features/spectrogram/spectrogramView.tsx`; modify both i18n
files for the lane meta key.

1. Add `lane: LaneIndex` to `useSpectrogramJob(original, params, lane)`.
   Replace the chunk derive with
   `deriveWithSourceSliceLane("spectrogramTiles", request.params,
   request.startSample, request.endSample, lane)`.
   Include the lane in the effect dependency list; the cache key already
   separates lanes.
2. In `SpectrogramView`:
   ```ts
   const { mode, modes, setMode } = useChannelMode(original, "single");
   const lane = laneIndexForSingleMode(mode) ?? 0;
   const job = useSpectrogramJob(original, analysis, lane);
   ```
3. Add `spectrogram.meta.channel` with the translated channel label. Render
   it in the existing meta list with `data-testid="spectrogram.meta.channel"`.
4. Place the picker in the controls grid. It must not shift the existing
   control test IDs.
5. Add English and Persian `spectrogram.meta.channel` keys:
   - en: `"Channel"`
   - fa: `"کانال"`
6. Run the web unit suite and typecheck.

**Acceptance:** mono canvas byte flow unchanged; selecting right starts new
chunk jobs with the lane suffix; no stale left chunks paint after a switch.

## Task 6 — Make FFT lane-aware

**Files:** modify `apps/web/src/features/fftview/fftView.tsx`; modify both
i18n files.

1. Add `lane: LaneIndex` to `useFftSpectrum` and switch to
   `deriveWithSourceSliceLane("fftSelection", params, start, end, lane)`.
2. Read the mode with `useChannelMode(original, "single")`; compute
   `lane = laneIndexForSingleMode(mode) ?? 0`.
3. Keep the existing selection/cap logic on `original.samples`; lane lengths
   are equal, so start/end need no conversion.
4. Add `fftview.meta.channel` and render
   `data-testid="fftview.meta.channel"` in the existing meta row.
5. Place the picker in the controls grid without changing existing test IDs.
6. Add en `"Channel"` and fa `"کانال"` keys.
7. Run the web unit suite and typecheck.

**Acceptance:** mono chart data unchanged; left/right produce distinct chart
data for the stereo demo; URL reload restores the channel.

## Task 7 — Add per-lane metrics

**Files:** create `apps/web/src/features/metrics/metricsLanes.ts`,
`apps/web/src/features/metrics/metricsLanes.test.ts`; modify
`apps/web/src/features/metrics/metricsView.tsx`; modify both i18n files.

1. Write failing tests for a pure selector:
   ```ts
   export type MetricsLaneProblem =
     | "missing"
     | "rateMismatch"
     | "lengthMismatch"
     | "channelsMismatch";

   export type MetricsLanePair = {
     readonly id: ChannelLaneId;
     readonly reference: Float32Array;
     readonly test: Float32Array;
   };

   export type MetricsLaneSelection =
     | { readonly ok: true; readonly lanes: readonly MetricsLanePair[] }
     | { readonly ok: false; readonly problem: MetricsLaneProblem };
   ```
   `selectMetricsLanes(original, processed, mode)`:
   - `missing` when processed is null;
   - `rateMismatch` when rates differ;
   - `lengthMismatch` when compared lane lengths differ;
   - `channelsMismatch` when a selected lane is absent from processed;
   - mono uses `samples` on both sides;
   - left/right use the matching channel on both sides;
   - both returns left then right.
2. Run the test; expect failure.
3. Implement `metricsLanes.ts` using `channelSignals` and
   `laneIndexForSingleMode`. Do not copy buffers.
4. Refactor `MetricsView`:
   - read `useChannelMode(original, "both")`;
   - call `selectMetricsLanes`;
   - keep the existing `metrics.missing`, `metrics.mismatch.length`, and
     `metrics.mismatch.rate` messages;
   - add `metrics.mismatch.channels` for a missing processed lane;
   - render one metric group per selected lane;
   - mono keeps the current `metrics.value.*` test IDs;
   - left uses `.left`, right `.right`, both uses `.left` and `.right`;
   - every group shows its channel label with `data-testid="metrics.label.<id>"`.
5. Extract `MetricsLanePanel` in the view for the async
   `measureQualityMetrics` call. It receives reference, test, and rate; it
   owns its pending/error state. Do not call hooks in a loop.
6. Add translations:
   - `metrics.mismatch.channels`:
     en `"The processed result does not have the selected channels. Choose Mono or run a channel-preserving tool."`;
     fa `"نتیجهٔ پردازش‌شده کانال‌های انتخاب‌شده را ندارد. مونو را انتخاب کنید یا ابزاری را اجرا کنید که کانال‌ها را حفظ می‌کند."`
   - Reuse `channel.mono`, `channel.left`, and `channel.right` for group labels; do not add a duplicate channel label key.
7. Run the selector test, the web unit suite, and typecheck.

**Acceptance:** mono metrics are unchanged; both renders two groups; missing
processed lanes never produce a fake comparison.

## Task 8 — E2E, docs, and phase verification

**Files:** create `apps/web/e2e/channel-analysis.spec.ts`; modify
`docs/PROGRESS.md`, `docs/DECISIONS.md`, `docs/ALGORITHMS.md`,
`docs/plans/wave-7/README.md`, and the Phase 1 spec status.

1. Add the e2e test using the bundled stereo demo clip
   (`input.demo.load.stereo`):
   - `/tools/waveform?ch=both`: load stereo; expect both overview canvases
     painted and both lane captions visible;
   - switch to right; expect `ch=right`, one detail canvas, right button
     pressed;
   - `/tools/spectrogram?ch=right`: load stereo; expect
     `spectrogram.meta.channel` to show the right label and canvas painted;
   - `/tools/fftview?ch=left`: load stereo; expect charts visible and the
     left button pressed;
   - collect console errors and page errors; assert both arrays are empty.
2. Reuse the existing canvas-paint helper pattern (poll alpha sum) and the
   existing `watchForErrors` pattern. Do not add a test framework.
3. Run:
   ```bash
   pnpm check
   pnpm --filter @avalab/web e2e channel-analysis.spec.ts
   ```
   The e2e command rebuilds `dist` first; do not run Playwright directly
   against a stale build.
4. Update `docs/DECISIONS.md` D-056:
   - status: accepted; Phase 1 implemented;
   - channel model: mono default, left/right opt-in, both only for waveform
     and metrics;
   - no per-lane params in Phase 1.
5. Update `docs/ALGORITHMS.md` with:
   - lane selection rule (mono = mean, left/right = stored playback lane);
   - lane-aware cache identity: existing three-part mono key stays unchanged;
     lane derives append `\u0000lane:<0|1>`;
   - no resampling between lanes because Phase 1 tools require equal lengths.
6. Update `docs/PROGRESS.md`:
   - Phase 1 complete/partial with exact test counts;
   - known limitations: independent L/R processing parameters are not
     implemented; `both` is not available in spectrogram/FFT; per-lane metrics
     compare same-rate, same-length lanes only;
   - manual checks still pending; needs Persian review.
7. Update `docs/plans/wave-7/README.md` with the spec and plan links and the
   Phase 1 status.
8. Mark the spec:
   ```md
   **Status:** approved design; Phase 1 implemented
   ```
9. Run `git diff --check` and inspect `git status --short`. Report the exact
   commands and results; do not claim tests passed without this run.

**Acceptance:** `pnpm check` and the new e2e pass; docs state the tested
limits honestly; no leftover `ch` state or stale lane job.

## Phase completion checklist

- [ ] Mono waveform/spectrogram/FFT/metrics DOM and test IDs unchanged.
- [ ] Mono derives keep three-part cache keys.
- [ ] Lane derives include the lane in the key and payload.
- [ ] Stereo demo supports waveform mono/left/right/both.
- [ ] Spectrogram and FFT support mono/left/right.
- [ ] Metrics supports mono/left/right/both with honest mismatch messages.
- [ ] `ch` is URL-backed and survives reload.
- [ ] Both locales contain every key; `pnpm i18n:check` passes.
- [ ] `pnpm check` and `channel-analysis.spec.ts` pass in this session.
- [ ] No console errors in the exercised e2e paths.
- [ ] Docs and Phase 1 status are honest about untested manual checks.
- [ ] Owner reviews the diff before any commit.
