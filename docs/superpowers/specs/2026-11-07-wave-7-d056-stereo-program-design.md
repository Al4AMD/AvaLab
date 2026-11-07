# Wave 7 — D-056 Stereo Program Design

**Status:** approved design; Phase 1 implemented
Date: 2026-11-07
Owner: Aliakbar
Feature IDs: F01, F02, F03, F04, F05, F06, F07, F08, F09, F10, F11, F15
Decision: completes the work deferred by D-056 without changing the 2-channel or mono-AI boundaries.

## 1. Goal

Complete the deferred stereo work as one ordered program:

- per-channel analysis and display;
- per-channel DSP and toy codecs;
- true-stereo 4-path reverb;
- stereo pipeline execution;
- full-file stereo real-codec jobs.

Mono remains the default analysis lane. Existing mono results, URLs, and tests must stay valid.

## 2. Scope

### In scope

- 1–2 channel sources, already preserved by F01.
- Mono / left / right / both selection per relevant tool.
- Independent L/R parameters only where the output sample rate and length stay identical.
- Shared grid parameters for sampling rate, speed/time-length, extent length, real-codec settings, reverb IR, and pipeline graph.
- Stereo waveform, spectrogram, FFT, metrics, spectrum editing, filters, sampling, speed, extent, toy codecs, reverb, pipeline, and real codecs.
- Async full-file real-codec jobs with SSE progress and cancel.
- Upload cap raised to a configurable 200 MB default for full-file codec jobs.
- fa/en copy, theory updates, golden/property/e2e coverage, and docs.

### Out of scope

- More than two input channels; >2 still folds to mono with the existing notice.
- Stereo AI; ML remains mono and keeps its label.
- Per-node L/R parameter overrides in the pipeline graph.
- Joint-stereo coding or per-lane real-codec settings.
- New ML models or DSP dependencies.
- User accounts, storage of user audio in URLs, or permanent file storage.

## 3. Invariants

1. `SessionSource.samples` and `ProcessedSource.samples` remain the mono analysis/fallback lane.
2. `channels` remains the 1–2 lane playback/export representation.
3. Mono mode must be byte-identical to current behavior.
4. No DSP runs on the main thread.
5. Independent L/R parameters cannot produce mismatched lane rates or lengths.
6. Real codecs and the pipeline remain shared streams/graphs.
7. AI remains mono.
8. No new dependency or model without the usual decision record.

## 4. Channel model

### 4.1 Modes

Add a shared per-tool `ChannelMode`:

```ts
type ChannelMode = "mono" | "left" | "right" | "both";
```

- `mono`: use the mono downmix. Existing behavior.
- `left` / `right`: use one playback lane.
- `both`: process/display both lanes.
- Mono sources hide or disable `left`, `right`, and `both`.
- Tools choose their supported subset:
  - waveform: mono/left/right/both;
  - spectrogram and FFT: mono/left/right;
  - processing tools: mono/left/right/both where meaningful;
  - reverb: mono/left/right/stereo, where `both` is named stereo;
  - real codecs: mono/stereo stream only.

### 4.2 Parameters

Use a primary + right-override state:

```ts
type LaneParams<T> = {
  primary: T;
  right?: T;
};
```

- Mono and left use `primary`.
- Right uses `right` when present, otherwise `primary`.
- Both uses `primary` for left and `right` for right.
- Default `right` mirrors `primary` until the user unlinks.
- Grid-affecting fields are stored outside `LaneParams` and copied into both lane calls.
- Existing URL parameters map to `primary`; absent channel mode means `mono`.

This preserves old links and avoids tripling state for mono-only use.

### 4.3 Grid compatibility

A tool may expose independent L/R parameters only when both lanes keep the same output sample rate and length.

| Tool | Shared grid | Independent L/R |
|---|---|---|
| Filters | none | design and apply parameters |
| Spectrum edit | selection/FFT size | Re/Im edits, masks |
| Toy codecs | block/frame settings needed for alignment | codec choice, bit budget, quantizer |
| Sampling | target rate, anti-alias | bit depth, dither |
| Speed | speed, mode, pitch | reverse |
| Extent | operation, length/shift/scale | none |
| Reverb | IR, pre-delay, wet/dry | none |
| Pipeline | whole graph | none |
| Real codecs | codec and params | none |

The UI marks shared fields as locked when both lanes are active. Changing a shared field updates both lanes.

## 5. Analysis and display

- Waveform: mono default; left/right/both selectable; both stacks two lane canvases with shared time axis.
- Spectrogram: mono default; left/right selectable; one lane at a time.
- FFT: mono default; left/right selectable; one lane at a time.
- Metrics: mono row in mono mode; selected lane row in left/right mode; both rows in both mode. No invented single stereo score.
- A/B playback uses the existing stereo transport.
- The player mono-result badge and theory note remain valid; copy is extended to mention per-channel modes.

## 6. Processing architecture

### 6.1 Per-lane calls

Reuse the existing mono worker ops. For each lane:

1. select the lane payload;
2. build the lane-specific parameters;
3. call the existing op with a lane-aware cache key;
4. validate equal length/rate;
5. combine lanes and call `setProcessed`.

No worker protocol change is needed. The main thread only copies and combines arrays; it does not run DSP.

### 6.2 Cache keys

Add lane-aware derive helpers:

```ts
deriveWithSourceLane(op, params, lane)
deriveWithSourceSliceLane(op, params, start, end, lane)
```

The cache key appends the lane index to the existing `op + params + inputHash` key. This prevents identical L/R parameters from aliasing. Mono keys stay unchanged.

### 6.3 Limits

- Live preview remains the existing excerpt cap (default 30 s).
- Per-lane processing doubles worker work. If a tool misses its preview budget, reduce that tool's preview length rather than moving DSP to the main thread.
- Full-file processing uses the existing caps or the new async codec job path.

## 7. Tool behavior

### F02 Waveform and spectrogram

- Waveform both mode stacks lanes.
- Spectrogram selects one lane; no overlay in this program.
- Selection and playhead stay shared.

### F03 Sampling and quantization

- Shared target sample rate and anti-alias setting.
- Independent bit depth and dither per lane.
- Lane outputs must keep equal length and rate; the shared grid enforces this.
- Quantization error and SNR shown per lane.

### F04 Toy codecs

- Independent codec choice and bit/quantizer settings per lane.
- Each lane encodes and decodes independently; lanes recombine only if lengths match.
- Stats aggregate: total encoded bytes/bits, combined ratio/bitrate, bit-exact only if every lane is exact.
- MDCT remains per-lane; no joint-stereo coding.

### F05 Metrics

- Metrics measured per lane against the corresponding reference lane.
- Mono mode measures the downmix as today.
- Alignment and length checks remain mandatory.

### F06 Speed and direction

- Shared speed, mode, and pitch.
- Independent reverse per lane.
- Time-stretch runs independently per lane with the same speed. Independent phase-vocoder lanes can move the stereo image; theory copy must state this.
- Resampling mode remains shared because it changes rate/length.

### F07 Extent

- Shared operation and length-changing parameters.
- Per-lane energy/power/support stats.
- No independent scale/truncate lengths.

### F08 FFT

- Mono/left/right selection.
- Window/FFT parameters apply to the selected lane.
- Benchmark and butterfly views stay mono.

### F09 Spectrum editor

- Independent Re/Im edits and frequency masks per lane.
- Hermitian enforcement per lane.
- IFFT per lane, then recombine.
- Presets apply to the selected lane or both with explicit UI copy.

### F11 Filters

- Independent filter design/apply parameters per lane.
- Equal length and rate guaranteed by the filter design.
- Pole-zero, response, and stability views show the selected lane.

### F10 Reverb

Mono mode keeps the existing `reverbProcess` unchanged.

Stereo mode adds a 4-path true-stereo convolution:

```text
yL = xL * LL + xR * RL
yR = xL * LR + xR * RR
```

- Uploaded IR:
  - 2-channel: `LL = L`, `RR = R`, cross paths zero.
  - 4-channel: order `LL, LR, RL, RR`; documented in UI and `ALGORITHMS.md`.
- Built-in presets:
  - `LL` and `RR` use the existing preset IR/seed.
  - `LR` and `RL` use deterministic decorrelated synthetic IRs from adjacent seeds, scaled by a documented cross gain of 0.5; no extra normalization is applied, so wet/dry controls level.
- Pre-delay applies to both source lanes before convolution.
- Wet/dry mix is shared; output is stereo.
- Output length: `preDelay + N + max(IR lengths) − 1`.
- Direct convolution only for ≤2 s source excerpts; FFT otherwise.
- Left/right solo uses the existing mono reverb on that lane and outputs mono.
- Mono source cannot enter stereo/4-path mode.
- Golden tests compare each path with SciPy; diagonal mode equals two independent mono reverbs; cross paths and rate conversion are covered.

### F15 Pipeline

- Run the same validated graph on each selected lane.
- Combine corresponding outputs only when rate and length match.
- Per-lane output stats; no per-node channel overrides.
- The pipeline URL schema is unchanged.

### F01 Full-file real codecs

Keep the 30 s synchronous excerpt path.

Add an explicit "Process whole file" path:

1. The browser encodes the full source as 16-bit PCM WAV.
2. Upload via the existing validated `/ingest` flow.
3. Submit `POST /codec/jobs` with `audio_id`, codec, and params.
4. Stream `GET /codec/jobs/{job_id}/events`.
5. Cancel with `DELETE /codec/jobs/{job_id}`.
6. Fetch and play/export the aligned result via `/audio/{audio_id}`.

`CodecJobManager` requirements:

- bounded worker pool, default concurrency 1, queue cap 8;
- TTL cleanup of jobs and persisted results;
- progress events for encode, decode, align/store;
- cancellation terminates the ffmpeg process and removes partial files;
- fixed argument arrays, no shell, validated codec params;
- result metadata matches the synchronous route plus `channels` and job timing;
- mono-reference alignment, every lane trimmed;
- `bit_exact` requires all lanes.

Upload cap:

- raise the configurable `AVALAB_MAX_UPLOAD_BYTES` default from 100 MB to 200 MB;
- record the change in `DECISIONS.md`;
- 5 min stereo at 96 kHz in 16-bit WAV is ~115 MB, so the new default covers it;
- duration, channel, sample-rate, and file-size checks still run before heavy work.

## 8. UI and state

- Add a shared channel selector component with translated labels and test IDs.
- Show lane badges (`L`, `R`, `Mono`, `Stereo`) consistently.
- Shared grid fields are visually locked in both mode.
- Reverb gets a 4-path matrix view and IR upload validation.
- Codec lab gets a whole-file action, job progress, cancel, and error states.
- No user audio in URLs.
- URL state adds channel mode and lane parameters; old URLs decode to mono/primary.
- Persist last-used channel settings per viewer, not globally.

## 9. Error handling

Stable error codes, translated by the frontend:

- `invalid_request` for bad channel/param combinations;
- `file_too_large` for upload cap;
- `encode_failed` for codec failure;
- `codec_unavailable` for missing encoders;
- `job_not_found`, `job_cancelled`;
- new `job_busy` for a full codec queue;
- existing worker `badParams` / `badPayload` / `tooLong` codes for DSP.

No raw backend messages in the UI. No audio content or filenames in logs.

## 10. Performance

- No main-thread DSP.
- Per-lane live preview must stay within the existing preview budget; if not, shorten the preview for that tool.
- Waveform both mode and spectrogram lane selection must not block the main thread.
- Full-file codecs run in the async job queue; the UI stays responsive.
- 4-path reverb uses FFT convolution for long IRs and reports progress/cancel through the existing processing path.
- Memory: avoid packing copies when a lane can be transferred directly; release intermediate buffers after combining.

## 11. Internationalization

- All new strings in `en.json` and `fa.json`.
- Persian copy follows the existing academic style and is flagged for human review.
- Plots, values, and units stay LTR.
- Explain:
  - mono default and why;
  - shared versus independent lane settings;
  - stereo image caveat for independent phase vocoders;
  - true-stereo IR matrix order;
  - full-file upload and TTL privacy.

## 12. Testing

Every phase includes:

- mono regression tests proving unchanged outputs and URLs;
- unit tests for channel state, lane cache keys, combine guards, and shared-grid locking;
- DSP golden/property tests for new math, especially 4-path convolution;
- worker tests for per-lane calls and limits;
- API tests for codec job lifecycle, queue cap, cancel, progress, upload cap, alignment, and bit-exactness;
- Playwright smoke for each changed tool in fa and en;
- no console errors in the exercised flow;
- performance checks for two-lane previews and full-file jobs.

## 13. Rollout

Program spec plus one implementation plan per phase:

1. Channel foundation and analysis (state, lane keys, waveform/spectrogram/FFT, metrics).
2. Grid-safe processors (filters, spectrum edit, toy codecs).
3. Grid-changing processors (sampling, speed, extent).
4. True-stereo reverb.
5. Stereo pipeline.
6. Async full-file codecs and upload cap.
7. Hardening, docs, bilingual/E2E, release notes.

Each phase must leave the repo green and runnable. Do not start a later phase while an earlier gate fails.

## 14. Documentation

- Update `docs/ALGORITHMS.md`:
  - per-lane processing semantics;
  - lane cache keys;
  - stereo WAV/export behavior already documented;
  - 4-path true-stereo convolution;
  - full-file codec job alignment.
- Update `docs/DECISIONS.md`:
  - D-056 status and completion criteria;
  - 200 MB upload cap;
  - independent L/R parameter rule and shared-grid exception;
  - mono AI and 2-channel boundaries reaffirmed.
- Update `docs/PROGRESS.md` and `docs/plans/wave-7/README.md`.
- Update theory panels and i18n.
- No new model entries; no new dependencies expected.

## 15. Risks

- Independent L/R params can make comparisons unfair; shared-grid locks and UI warnings mitigate.
- Independent phase vocoders can shift the stereo image; document and test.
- 4-path reverb is 4× the convolution work; FFT and excerpt caps mitigate.
- Full-file upload raises privacy/disk cost; TTL, explicit action, and no URL audio mitigate.
- Two worker calls per tool can miss preview budgets; shorten previews if measured.
- Larger URL state; compact encoding and existing caps mitigate.
- Codec cancellation must kill ffmpeg reliably; tests cover the lifecycle.

## 16. Resolved decisions

- Input remains capped at two channels; >2 still folds to mono.
- AI remains mono; no stereo model work.
- Mono remains the default; stereo is opt-in.
- Independent L/R params apply only to grid-compatible fields.
- Reverb uses a 4-path true-stereo IR matrix.
- Full-file codecs use async jobs with SSE and cancel.
- Upload cap default rises to 200 MB.
- Pipeline uses one shared graph on both lanes.
- Program work lives under Wave 7, not Wave 6.

## 17. Completion criteria

D-056 is complete when:

1. All seven rollout phases are shipped with green gates.
2. Stereo sources can be analyzed, reversed, filtered, resampled, speed-changed, codec-tested, reverbed, and pipelined per lane, and real-codec exported as mono or stereo.
3. Mono behavior and existing URLs remain compatible.
4. True-stereo 4-path reverb and async full-file codecs are covered by tests and docs.
5. AI and >2-channel boundaries are documented and unchanged.
6. `ALGORITHMS.md`, `DECISIONS.md`, `PROGRESS.md`, and the Wave 7 README are current.
