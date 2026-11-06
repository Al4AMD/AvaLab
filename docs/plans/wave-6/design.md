# Wave 6 — Full Feature Closure and Release Design

Status: approved
Date: 2026-11-04
Repo: `AvaLab`
Branch at design time: `feat/wave-5` (Wave 5 merged to `main` as PR #11)

## 1. Intent

Wave 6 closes every remaining P0/P1 feature gap, finishes the P2/P3 features the owner
selected, hardens the application, deploys it for university use, and produces the Persian
PDF report and presentation slides. This is the final implementation wave.

The owner selected full gap closure, not a polish-only release. The previously deferred
F08, F09, F12, F14, and F16 items are therefore part of Wave 6, together with the planned
F13, F15, and F18 work.

Success means:

- Every P0/P1 feature in `AGENTS.md` is implemented and verified in both `fa` (RTL) and
  `en` (LTR).
- F13 psychoacoustics is integrated into the MDCT toy codec, not merely visualized.
- F15 is a working branching DAG pipeline with a real worker execution path.
- F18 includes BS.1770 loudness matching, theme support, shortcuts, and persistence.
- The deferred F08/F09/F12/F14/F16 gaps are closed.
- Docker deployment works CPU-only and offline after model prefetch.
- The Persian PDF report and Persian PDF slides are generated and checked.
- The app remains usable when the backend is unreachable; backend-only tools disable
  honestly.

## 2. Scope

### 2.1 In scope

- F13 psychoacoustics and masking-aware MDCT quantization.
- F15 branching visual pipeline builder.
- F18 quality-of-life: BS.1770 loudness matching, theme, shortcuts, persistence,
  responsive polish.
- F08 Cooley–Tukey butterfly step-through, FFT benchmark, full-file STFT benchmark.
- F09 freehand/brush spectrum drawing.
- F12 AM/FM generator modes and Fourier-series reconstruction UI.
- F14 pitch/F0 and beat tracking using `librosa`, with no new model weights.
- F16 theory panels and 5–8 guided experiments for every P0/P1 tool.
- Baseline correctness fixes and a feature-by-feature gap audit.
- Performance, accessibility, and Persian review passes.
- Docker deployment, offline model workflow, and university proxy guidance.
- Persian PDF report, Persian PDF slides, final documentation.

### 2.2 Out of scope

- F05 optional perceptual metric (PESQ/ViSQOL). D-005 remains an owner decision.
- User accounts, database, social features, payments, DAW editing.
- Training or fine-tuning models.
- New model weights beyond the five pinned Wave 5 models.
- WebAssembly DSP. D-006 remains benchmark-gated.
- Reworking Wave 5 model choices or licenses.
- Committing generated PDF binaries unless the owner explicitly approves their size.

## 3. Non-negotiable constraints

- DSP remains pure, deterministic, DOM-free TypeScript in `packages/dsp`.
- All audio math runs in Web Workers or AudioWorklets, never on the main thread.
- UI components hold no DSP logic; tool state is a pure function of input and params.
- No hard-coded user-visible strings. Every string exists in both `en.json` and `fa.json`.
- CSS uses logical properties; plots, formulas, time axes, and frequency axes stay LTR.
- Every numeric parameter is finite and validated at the worker boundary.
- New DSP has golden vectors from `tools/golden` and at least one property test.
- Legacy MDCT output, goldens, and share-link behavior remain valid. New modes are
  explicit and opt-in.
- Existing public interfaces stay stable unless this design says otherwise.
- No secrets, copyrighted audio, personal paths, or unlicensed assets.
- Do not edit `AGENTS.md` unless the owner asks.
- Do not commit unless the owner explicitly asks. This design follows the session rule,
  not the brainstorming skill's default commit step.

## 4. Wave 6 plan structure

Wave 6 uses one design and eight implementation plans under `docs/plans/wave-6/`:

| Plan | Scope | Depends on |
|---|---|---|
| `00-baseline.md` | Baseline fixes, gap audit, main-thread cleanup | none |
| `01-psychoacoustics.md` | F13 model, MDCT integration, tool view | 00 |
| `02-pipeline.md` | F15 DAG DSL, engine, worker op, UI | 00 |
| `03-quality-of-life.md` | F18 BS.1770, gain seam, theme, shortcuts | 00 |
| `04-feature-gaps.md` | F08, F09, F12, F14, F16 | 00–03 |
| `05-polish.md` | Performance, accessibility, responsive, Persian review | 01–04 |
| `06-deployment.md` | Docker, offline models, proxy runbook | 01–05 |
| `07-release.md` | PDF report, PDF slides, final docs, closeout | 01–06 |

Each plan must leave the repository green. A later plan must not start while an earlier
plan has failing checks. Plan 04 is deliberately last among feature plans because the plan
00 audit defines its exact gap list.

## 5. Plan 00 — baseline and gap audit

### 5.1 Fixes

- FFT phase-mask bug in `apps/web/src/features/fftview/fftView.tsx` around line 435:
  the linear magnitude is recomputed from an already-dB `spectrum.magnitude`. Fix the
  unit handling so the default phase chart is not blank.
- Stale AI results: an in-flight AI result must not install after the source changes.
  Install keyed by source input hash/request identity, not only by result audio id.
- Excerpt offset installs: AI excerpt-processed lanes are installed at sample 0. Preserve
  the source offset so A/B playback maps absolute time correctly.
- ASR reference transcript matching: match by content/request identity, not by filename.
- `GET /models` must report `ml_enabled=false` honestly instead of advertising cache
  availability while `POST /ml` returns 503.
- Denoise A/B must read only a denoise result, not any processed lane.
- SSE parser must not leave a stray `\r` when CRLF splits across chunks.
- Move remaining main-thread envelope math to worker ops:
  - metrics/comparison `realRow` envelope;
  - extent mini-waveform envelope;
  - reverb mini-waveform envelope.

### 5.2 Gap audit

Write `docs/plans/wave-6/audit.md` mapping every `AGENTS.md` feature bullet F01–F18 to:

- implemented and tested;
- partial, with the exact missing part;
- missing;
- intentionally out of scope (with the decision reference).

The audit must name files and tests. It drives plan 04 scope. No feature is silently
dropped.

### 5.3 Tests

- Regression tests for every fixed bug.
- Worker tests for moved envelopes.
- `pnpm check`, relevant Playwright, API tests if an API fix changes behavior.

## 6. F13 — Psychoacoustics and masking-aware MDCT

### 6.1 New DSP module

Create `packages/dsp/src/psychoacoustics/` with pure functions:

- Bark conversion and band edges.
- Absolute threshold of hearing (ATH).
- Spreading function and masking threshold.
- Band level and signal-to-mask ratio (SMR).

Constants and formulas:

- Bark scale (Zwicker–Terhardt approximation):
  `z(f) = 13 atan(0.00076 f) + 3.5 atan((f / 7500)^2)`.
- Bands: 25 bands, edges at Bark `z = 0..25`, converted to Hz and clamped to Nyquist.
- ATH (Terhardt):
  `Tq(f) = 3.64 (f/1000)^-0.8 - 6.5 exp(-0.6 (f/1000 - 3.3)^2) + 1e-3 (f/1000)^4`
  in dB SPL.
- Schroeder spreading:
  `S(dz) = 15.81 + 7.5 (dz + 0.474) - 17.5 sqrt(1 + (dz + 0.474)^2)` in dB.
- Band level from MDCT coefficients:
  `L_i = refSplDb + 10 log10(sum_{k in band i} C_k^2 / P_ref)`.
- Masking threshold:
  `T_i = max(ATH_i, 10 log10(sum_j 10^((L_j + S(z_i - z_j)) / 10)))`.
- SMR: `SMR_i = L_i - T_i`.

Calibration:

- `refSplDb = 94` dB SPL for a full-scale sine (1 Pa reference). The UI exposes a
  reference-level control with a safe range of 80–100 dB SPL.
- `P_ref` is measured from a 1 kHz full-scale sine through the same MDCT frame/window
  configuration. It is not hard-coded to a window-dependent constant.
- The model is a teaching approximation. It is stationary per frame, has no temporal
  masking, no tonal/noise masking distinction, and treats ATH as a per-band level. The UI
  and `ALGORITHMS.md` must say this explicitly.

### 6.2 Masking-aware MDCT codec

Create `packages/dsp/src/codecs/mdctPsycho.ts` beside the legacy codec. Do not change the
legacy `encodeMdct`/`decodeMdct` contract or goldens.

Per frame:

1. Run the existing MDCT.
2. Compute per-band levels, ATH, spread threshold, and SMR.
3. Compute the per-band mask-limited step:
   `sMask_i = sqrt(12 * T_i_linear / n_i)`,
   where `T_i_linear = P_ref * 10^((T_i - refSplDb) / 10)` and `n_i` is the number of MDCT
   bins in the band (empty bands are skipped).
4. Compute the legacy global rate step:
   `sGlobal = GM * 2^(-bitsPerSecond / sampleRateHz)`.
5. Use `s_i = max(sMask_i, sGlobal)`. Masking may make a band coarser; the target rate
   remains a cap, so the codec never spends bits the budget cannot afford.
6. Quantize with `q_k = clip(round(C_k / s_{b(k)}), -32768, 32767)`, then use the same
   zigzag and canonical Huffman path as the legacy codec.

Container and stats:

- Carry per-frame, per-band steps as side information.
- Report entropy bits, side-information bits, total container bits, actual bitrate,
  masked-coefficient fraction, per-band thresholds, and per-band SMR.
- Count side information in the displayed total bitrate. Keep the entropy-only bit count
  visible so students can separate model overhead from payload.
- Decode must reproduce the exact quantized indices and audio for the same container.

The masking model compares threshold and quantization noise in the MDCT coefficient
domain. It intentionally omits transform gain and is documented as a nominal teaching
model, not a standards-compliant MP3/AAC encoder.

### 6.3 Codec lab integration

- The MDCT codec in `codecLabProcess` gains `psychoacoustic: boolean` and
  `referenceSplDb: number`.
- New runs default to psychoacoustic mode ON. A visible "Legacy uniform quantizer" toggle
  restores the Wave 4 behavior.
- The UI shows the per-band threshold/SMR chart, masked share, and total bitrate.
- URL state adds a compact mode flag. An absent flag means legacy uniform mode so old
  share links keep their Wave 4 result; new UI runs write the explicit psychoacoustic flag.
- The existing 30 s excerpt cap remains.

### 6.4 F13 tool view

New route `/tools/psychoacoustics`, registered in `TOOL_IDS`, sidebar, and i18n.

- Without audio: ATH and spreading-curve explorer.
- With audio: source spectrum + masking threshold overlay for the selected frame.
- Controls: reference SPL, band display, linear/log frequency, threshold visibility.
- Theory panel: ATH, critical bands, simultaneous masking, SMR, and why codecs discard
  masked content.
- Link to the codec lab with the current source.

### 6.5 Testing

- Python golden reference in `tools/golden` for Bark edges, ATH, spreading, band levels,
  masking threshold, and SMR.
- Property tests: monotonic Bark conversion; threshold never below ATH; silence produces
  no finite-step failure; empty bands are skipped.
- MDCT psycho round-trip test on deterministic signals; verify decode matches the encoded
  indices and audio.
- Regression test: legacy `encodeMdct` output is byte-identical to the Wave 4 golden.
- UI Playwright smoke in `fa` and `en`: open F13, load demo clip, see threshold chart, run
  psycho MDCT in the codec lab, no console errors.

## 7. F15 — Branching pipeline builder

### 7.1 Dependency

Add `@xyflow/react` (MIT) to `apps/web`. Record the dependency, version, license, and
justification in `docs/DECISIONS.md` and `docs/THIRD_PARTY.md`.

### 7.2 DSL

Create a versioned graph type in `packages/dsp/src/pipeline/types.ts`:

```ts
type XY = { x: number; y: number };

type PipelineNode =
  | { id: string; kind: "source"; params: Record<string, never>; position: XY }
  | { id: string; kind: "resample"; params: { targetRateHz: number; antiAlias: boolean }; position: XY }
  | { id: string; kind: "filter"; params: FilterApplyParams; position: XY }
  | { id: string; kind: "quantize"; params: { bits: number; dither: boolean; seed: number }; position: XY }
  | { id: string; kind: "codec"; params: { codec: CodecLabCodec; mdctBitsPerSecond: number; psychoacoustic: boolean }; position: XY }
  | { id: string; kind: "reverb"; params: ReverbProcessParams; position: XY }
  | { id: string; kind: "reverse"; params: Record<string, never>; position: XY }
  | { id: string; kind: "timeStretch"; params: { speedFactor: number; pitchSemitones: number }; position: XY }
  | { id: string; kind: "output"; params: { label: string }; position: XY };

type PipelineEdge = { id: string; from: string; to: string };
type PipelineGraph = { version: 1; nodes: readonly PipelineNode[]; edges: readonly PipelineEdge[] };
```

Rules:

- Exactly one source node.
- At least one output node.
- Fan-out allowed.
- No merge: every non-source node has exactly one incoming edge.
- No cycles.
- Maximum 24 nodes.
- Maximum 2 output nodes with audio payloads.
- Node IDs and edge IDs are stable, non-empty, and unique.
- A node's params are validated by the same DSP function that executes it.

### 7.3 Execution engine

Create `packages/dsp/src/pipeline/runPipeline.ts`:

- Topologically sort the graph; reject cycles and disconnected nodes.
- Start from the source excerpt.
- Execute each node with its pure DSP function.
- Apply stages in graph order, not UI order.
- Return:
  - per-stage summaries: sample count, sample rate, duration, peak, RMS, processing time,
    and a compact waveform envelope;
  - output PCM for up to two output nodes;
  - total timing.
- Intermediate stage PCM is not returned. Students preview an intermediate result by
  attaching an output node or selecting it as the output.
- Codec and filter stages use the same implementations as their dedicated tools.
- Pipeline execution runs entirely in the worker.

Worker op:

- `pipelineRun` params: `{ graph, sampleRateHz, startSample, endSample }`.
- Payload: the source excerpt.
- Use `deriveWithSourceSlice` with the range in params. The cache key includes the range,
  so two ranges never collide.
- Enforce the 30 s excerpt cap and the node/output caps in the worker, not only in the UI.

### 7.4 UI

New route `/tools/pipeline`, registered in routes, sidebar, and i18n.

- React Flow canvas with LTR coordinates.
- Node palette: source, resample, filter, quantize, codec, reverb, reverse, time-stretch,
  output.
- Properties panel in the current locale; technical values and units LTR.
- Run button with cancel; stage cards show timing and stats.
- Output node selection and playback through the processed lane.
- Validation messages are translated and point at the offending node/edge.
- Save/load JSON; share graph in the URL with a compact schema.
- Cycle detection and cap errors are shown before dispatch.
- No main-thread DSP; no worker call while the graph is invalid.

### 7.5 Testing

- DSP tests: linear chain, fan-out to two outputs, reverb, resample, codec, reverse,
  time-stretch.
- Validation tests: no source, multiple sources, no output, cycle, merge, >24 nodes,
  >2 outputs, disconnected node.
- Worker tests: payload cap, range key uniqueness, result shape.
- Playwright `fa`/`en`: add source → filter → output, run, play, reload URL, no console
  errors.

## 8. F18 — Quality of life

### 8.1 Loudness

Create `packages/dsp/src/metrics/loudness.ts`:

- ITU-R BS.1770 K-weighting (high-shelf pre-filter + RLB high-pass).
- 400 ms blocks with 75% overlap.
- Absolute gate at -70 LUFS; relative gate at -10 LU below the ungated mean.
- Integrated loudness in LUFS.
- 48 kHz coefficients exactly as specified; other rates derived with the standard bilinear
  transform and validated against `ffmpeg` `ebur128` at 44.1, 48, and 96 kHz.
- Document formulas, block/gating rules, and limitations in `docs/ALGORITHMS.md`.

Worker op `loudnessMeasure` returns per-lane LUFS and block statistics. It accepts a
bounded excerpt or full source within existing caps.

Player:

- Add a `GainNode` seam to the playback graph.
- A/B loudness match computes
  `gainDb = clamp(lufsOriginal - lufsProcessed, -24, 24)`
  and applies it to the processed lane. Switching to original resets gain to 0 dB.
- The toggle persists and is labeled honestly; no hidden normalization.

### 8.2 Theme, shortcuts, persistence

- Light/dark theme with `data-theme`, CSS variables, `prefers-color-scheme`, and the
  existing dark theme as default. Persist under `avalab.theme`.
- Review all tokens for light-mode contrast; spectrogram colormaps remain readable.
- Global shortcuts:
  - Space: play/pause.
  - Left/Right: seek -5 s/+5 s.
  - Shift+Left/Right: seek -10 s/+10 s.
  - `?`: help dialog.
- Shortcuts ignore inputs, text areas, selects, contenteditable elements, and dialogs.
- Bilingual help dialog lists shortcuts.
- Extend last-used settings persistence to tools that do not yet have it, using the
  existing `localStorage` pattern. No source audio is persisted.

### 8.3 Testing

- Loudness golden vectors and known-level checks (1 kHz sine, silence, gated signal).
- Gain math tests and player mute/reset behavior.
- Theme e2e in both languages.
- Shortcut e2e: play/pause, seek, input guard, help dialog.
- Persistence reload e2e.

## 9. Deferred feature gaps

### 9.1 F08 — FFT teaching and benchmark

- Add `fftButterflySteps` in `packages/dsp/src/fourier/butterfly.ts` for N=8 and N=16.
  Return per-stage real/imag arrays and metadata. UI step slider, play/pause, and
  explanation of bit-reversal and twiddle factors.
- Add `fft.js` (MIT) as an `apps/web` dependency. Record in `DECISIONS.md` and
  `THIRD_PARTY.md`.
- Add `fftBenchmark` worker op:
  - our FFT vs naive DFT for accuracy;
  - our FFT vs `fft.js` for accuracy and wall-clock time;
  - sizes 256, 1024, 4096, 16384.
- Add `stftBenchmarkTiles` worker op:
  - process a row/tile range with our FFT-based STFT and `fft.js`;
  - return per-tile timings and maximum relative error;
  - the UI loops tiles for a full selected file with progress and cancel.
- The benchmark panel labels wall-clock numbers as machine-dependent. Timing is not a
  golden assertion; accuracy is.
- Tests: butterfly stages reconstruct the DFT within tolerance; benchmark accuracy;
  tile range validation; UI smoke.

### 9.2 F09 — Freehand spectrum drawing

- Extend the DSP spectrum edit model:
  `SpectrumCurveEdit { target: "re" | "im" | "mag" | "phase"; points: readonly {bin, value}[] }`.
- Brush stores at most 256 monotonic points. Strokes are resampled to bin positions and
  linearly interpolated.
- Units: magnitude stored linear (UI draws dB), phase radians, Re/Im linear.
- Apply legacy band edits first, then curves. Document the order.
- Worker validation: monotonic bins, finite values, bin bounds, point cap.
- URL: compact `cv` parameter; reject over-cap curves on decode rather than creating a
  giant link. Keep legacy `ed` links working.
- UI: brush toggle, target selector, brush width, undo-last, clear-all, 200 ms debounce.
- Tests: interpolation, order, bounds, URL round-trip, Playwright drag smoke.

### 9.3 F12 — AM/FM and Fourier series UI

- Extend `SynthWaveform` with `"am"` and `"fm"`; reuse existing `generateAm` and
  `generateFm`.
- Generator modes:
  - Basic: existing waveforms.
  - AM/FM: carrier Hz, modulation Hz, modulation index or frequency deviation, amplitude.
  - Fourier series: kind (square/sawtooth/triangle), frequency, amplitude, harmonics
    slider, preview, Gibbs-overshoot readout, load as source.
- Add worker ops for AM/FM and Fourier-series preview. `fourierSeriesPartialSum` already
  exists; no new DSP formula is invented.
- URL and localStorage cover the new fields with total decoding.
- Tests: DSP already has golden coverage; add UI state/URL tests and Playwright smoke.

### 9.4 F14 — Pitch/F0 and beat tracking

Backend:

- Add `librosa` to `apps/api` base dependencies. Record version and ISC license in
  `THIRD_PARTY.md`.
- Split task typing:
  - `ModelTask = Literal["denoise", "superres", "separation", "asr", "neural_codec"]`.
  - `AnalysisTask = Literal["pitch", "beat"]`.
  - `JobTask = ModelTask | AnalysisTask`.
- `JobManager.submit` accepts `JobTask`. Model registry remains keyed by `ModelTask`.
- `POST /api/v1/ml/{task}` accepts both families. Analysis tasks skip the model registry
  and use a small analysis runner.
- `MlResult.kind` gains `"analysis"`.
- New `apps/api/src/avalab_api/analysis/pitch.py`:
  - `librosa.pyin`; returns `timesSeconds`, `f0Hz`, `voicedProbability`.
- New `apps/api/src/avalab_api/analysis/beat.py`:
  - `librosa.beat.beat_track`; returns `tempoBpm`, `beatTimesSeconds`.
- Keep the 30 s excerpt cap and label it in the UI.
- `GET /models` stays model-only; analysis tasks do not appear as downloadable models.

Frontend:

- AI lab gains a sixth tab, `pitchBeat`.
- No model-availability banner for analysis tasks; show "classical DSP analysis, no model
  download".
- Two cards: pitch track chart and beat list/tempo.
- Results use the existing job/SSE/cancel path.
- Translations in both languages.

Tests:

- Backend unit tests with synthetic 220 Hz sine (pitch) and click track (beat), no model
  download.
- API contract tests for task validation and SSE result shape.
- Frontend stub e2e for the new tab.

### 9.5 F16 — Theory and guided experiments

- Add a theory panel to every P0/P1 tool: key formulas, short explanation, what to observe,
  common pitfalls.
- Add guided experiments with 5–8 steps for every P0/P1 tool. Key labs get 8:
  - FFT, codec lab, filters, spectrum editor, AI, pipeline, psychoacoustics.
- Experiment IDs include at minimum:
  `waveform-spectrogram`, `sampling`, `extent`, `fft`, `spectrum-edit`, `speed`, `reverb`,
  `filters`, `generator-fourier`, `codec-lab`, `metrics`, `ai-separation`, `ai-denoise`,
  `ai-superres`, `ai-asr`, `ai-neural-codec`, `ai-pitch-beat`, `pipeline`,
  `psychoacoustics`.
- Each experiment has: title, goal, steps, expected observations, and a deep link where
  applicable.
- All text exists in `en.json` and `fa.json`; Persian is academically appropriate.
- Persian content is flagged in `PROGRESS.md` until the owner reviews it.
- Playwright checks every experiment link opens the correct tool with zero console errors.

## 10. Deployment

### 10.1 Compose

- Keep `compose.yaml` web + API services.
- Add a persistent model-cache volume. API env:
  - `HF_HUB_OFFLINE=1`
  - `TRANSFORMERS_OFFLINE=1`
  - model cache directory matching the API settings
  - `AVALAB_PUBLIC_ORIGIN` for CORS
  - TTL, upload limits, ML concurrency, device
- CPU-only default. Add an optional GPU override profile, clearly marked untested on the
  owner's hardware.
- Non-root API user, health checks, TTL cleanup, no secrets committed.
- `.env.example` documents every variable.

### 10.2 Offline models

- `apps/api/scripts/download_models.py` prefetches every pinned revision.
- Runbook: prefetch with network, then start the stack with the network disabled and
  verify `/health` and `/models` show all five models available.
- The model cache volume survives container recreation.

### 10.3 Reverse proxy

- Caddy web service serves the SPA and proxies `/api/*` to the API.
- SSE route `/api/v1/jobs/*/events` must disable response buffering
  (`flush_interval -1` in Caddy).
- University proxy runbook:
  - disable buffering for the SSE route;
  - set a read timeout longer than the longest ML job;
  - forward `X-Forwarded-*`;
  - terminate TLS at the university proxy, keep the app on HTTP inside the network.
- The public origin is configured by env; no domain is hard-coded.

### 10.4 Verification

- `docker compose build`, `docker compose up -d`, health and models checks.
- Browser smoke against the Docker stack in both languages.
- Upload, real codec, and one ML job from the UI.
- Offline model run with network disabled.
- Use a temporary host port during local verification because port 8080 is occupied on the
  owner's machine.

## 11. Persian PDF report and slides

### 11.1 Sources

- `docs/report/` contains RTL HTML/CSS sources, assets, and build scripts.
- `docs/slides/` contains the 16:9 slide sources.
- Self-hosted Vazirmatn; Latin formulas, code, and numeric readouts in LTR islands.
- Generated PDFs go to `docs/deliverables/`. They are committed only if the owner
  approves the binary size.

### 11.2 Build

- Use Playwright Chromium `page.pdf()` for both:
  - A4 portrait report;
  - 16:9 landscape slides.
- No pandoc, tectonic, or typst dependency.
- A single command builds both; the build fails on missing fonts, missing images, or
  overflow.
- Screenshots come from deterministic demo clips. AI figures use cached/precomputed
  outputs so the report build does not depend on a live model run.

### 11.3 Content

- Course mapping for Signals and Systems and Multimedia Systems.
- Architecture and data-flow explanation.
- Algorithm formulas and educational notes.
- Feature walkthrough with screenshots.
- Experiment examples and expected observations.
- Benchmark and quality results.
- Limitations and honest notes on approximations.
- References, licenses, and model provenance.
- Persian prose; Latin technical terms as needed.

### 11.4 Verification

- PDF page count, font embedding, RTL shaping, no clipped text, no overflow.
- Slides render correctly in a PDF viewer.
- Owner Persian review before release.

## 12. Testing and verification

### 12.1 Per plan

- `pnpm check` (lint, typecheck, unit tests, i18n parity).
- Relevant Playwright tests in `fa` and `en`.
- API `uv run pytest`, `uv run ruff check .`, `uv run mypy .` when the API changes.
- `docs/PROGRESS.md` updated with what changed, what remains, and review items.

### 12.2 New DSP

- Golden vectors from `tools/golden` for F13, BS.1770, butterfly steps, and pipeline
  engine.
- Property tests for Parseval/round-trip/linearity where applicable.
- Edge cases: empty input, length 1, odd lengths, non-power-of-two, DC, full-scale,
  NaN/Infinity rejection, extreme sample rates.
- Performance benchmarks for FFT, STFT, MDCT, pipeline, and loudness.

### 12.3 Final gates

- Full `pnpm e2e` in both languages with zero console errors.
- API suite, ruff, mypy.
- Docker CPU build and smoke.
- Offline model run.
- 5-minute 44.1 kHz performance check against AGENTS §9 budgets.
- Main-thread DSP audit: no audio loops outside workers.
- Persian review of all new and carried copy.
- Report and slides render check.
- `docs/DECISIONS.md`, `docs/ALGORITHMS.md`, `docs/MODELS.md`,
  `docs/THIRD_PARTY.md`, and `docs/PROGRESS.md` current.

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| F13 masking model is approximate | Cite formulas, label the model, expose calibration, test against a NumPy reference, keep legacy mode |
| F13 per-band side info changes bitrate accounting | Report entropy bits, side-info bits, and total separately |
| F15 graph memory blows up | 24-node cap, 2-output cap, 30 s excerpt, summaries only for intermediate stages |
| React Flow bundle and RTL issues | Lazy-load the route, keep canvas LTR, Persian labels outside the canvas, bundle budget |
| `librosa` install size/CPU | Base dependency, no weights, 30 s cap, synthetic tests, honest ETA |
| `fft.js` is unmaintained | Pin version, use only in benchmark, keep our FFT as production path |
| BS.1770 at non-48 kHz | Derived coefficients validated against `ffmpeg ebur128` at three rates |
| University proxy buffers SSE | Document `flush_interval -1` and proxy settings; smoke test through a local proxy |
| Persian PDF font/shaping | Self-hosted Vazirmatn, Playwright print, visual and text checks |
| Report uses copyrighted media | Only self-generated/public-domain/CC0 demo clips |
| Scope creep | Plan 00 audit is authoritative; F05 remains out unless the owner adds it |

## 14. Decisions to record

Append to `docs/DECISIONS.md` after the current last decision:

- F13 psychoacoustic model, calibration, and masking-aware MDCT mode.
- F15 React Flow dependency, DSL, caps, and worker execution.
- F18 BS.1770 loudness matching and gain seam.
- F08 `fft.js` benchmark dependency and full-file STFT chunking.
- F09 freehand curve model, units, and URL cap.
- F14 `librosa` analysis tasks and job-task typing.
- F16 experiment coverage requirement.
- PDF report/slides toolchain and deliverable location.
- Deployment offline model-cache and proxy contract.

Update `docs/THIRD_PARTY.md` for `@xyflow/react`, `fft.js`, and `librosa`.
Update `docs/MODELS.md` only if model pins change; this design adds no new weights.

## 15. Definition of Done

All of the following must be true:

- Every P0/P1 feature in `AGENTS.md` is implemented.
- F13, F15, F18, F08, F09, F12, F14, and F16 are complete as designed.
- `pnpm check`, full e2e, API pytest/ruff/mypy, Docker build/smoke, and offline model run
  pass in this session.
- Both `fa` and `en` work; RTL and LTR layouts are checked.
- No known P0/P1 bug remains.
- Performance budgets are met or the misses are documented with evidence.
- Persian review is complete.
- PDF report and PDF slides exist and render correctly.
- Documentation is current and honest.
- The repository is left green and runnable.

## 16. Open owner inputs

- University server domain, TLS termination, and reverse-proxy details.
- Persian review availability and timing.
- Whether generated PDFs should be committed.
- Optional GPU availability; CPU remains the required baseline.
- F05 perceptual metric remains an owner decision and is not part of this wave.
