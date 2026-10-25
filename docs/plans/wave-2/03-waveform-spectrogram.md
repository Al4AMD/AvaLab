# Wave 2 · Plan 03 — Waveform and spectrogram (F02)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** The signal labs' eyes: waveform overview + detail with zoom/pan/selection and playhead sync, and a progressive spectrogram with real controls — all worker-backed, canvas-painted, bilingual, and within the §9 budgets.

**Architecture:** Spec §2.1/§2.6. Plan 01's op table + peak buckets are the substrate; spectrogram adds an op; canvases are dumb painters of transferred typed arrays. All time/frequency axis labels and plots are forced `dir="ltr"` (AGENTS §6) while surrounding chrome follows document direction.

**Tech Stack:** As Plan 01 (`uplot` still deferred — Plan 04's charts; Canvas 2D here by AGENTS §3 order). New deps: none.

**Spec:** `AGENTS.md` §3 (canvas), §6 (RTL plot rule), §9 (budgets, colormaps incl. colorblind-safe), F02.

## Review Focus

1. **Main-thread discipline under interaction** — zoom/pan/selection handlers must touch only cached typed arrays + canvas transforms; any recompute (buckets re-render at high zoom) routes back through the worker as an op (e.g. `waveformRange` for a narrow window) rather than looping in a component; no allocation inside the rAF paint path.
2. **Progressive + cancelable** — spectrogram tiles stream back in row-chunks; a params change or source change cancels the previous job (Plan 01 cancel contract) and the stale tiles never paint; tile cache keyed by `(inputHash, paramscanonical)` matches the store's cache so a zoom-out re-hit doesn't recompute (§10 derived-results rule).
3. **Worker intermediates die** — the spectrogram op must not retain the whole-file Float64 STFT structure between calls (Wave 1's 0.9 GB PV lesson); chunk-local float32 conversions only; review reads the op handler for accidental retention.
4. **Axis truth** — units on every axis (Hz/s/dB), `dir="ltr"` wrappers, log axis is genuinely log (10^n ticks), dB range control maps to paint scaling honestly; colorblind-safe colormap exists and is selectable; never color-only (colormap legend + min/max printed).
5. **Playhead sync** — one `playhead.ts` event source writes both canvases; selection ops are keyboard-reachable (arrow keys move/extend, translated ARIA descriptions); reduced-motion respected for tile animation.

---
### Task 1: Waveform canvases (overview + detail) — paint only

**Files:** Create `apps/web/src/features/waveform/{waveformView.tsx,canvasWaveform.ts,paintWaveform.ts}`; the `/tools/waveform` stub page consumes them; i18n keys `waveform.*`.

**Interfaces:**
- `paintWaveform(ctx, minMax: Float32Array, opts)` — pure painter: interleaved min/max buckets, device-pixel-ratio aware, center line, y-scale fixed to [-1, 1] with the peak range printed.
- The feature fetches `waveformOverview` buckets from the store's derive cache and paints; overview panel (top, fixed) + detail panel (bottom, scroll/zoom) target Plan-01 contract — zoom state lives in a small reducer (`zoomLevel`, `centerSample`) that is URL-serializable via `url-state` (waveform tool: `?t=<start..end>`).
- Hover readout: time in `s` (formatted via `formatS`, Latin digits) at pointer bucket.

**Tests:** paint math unit tests (bucket→pixel mapping incl. dpr rounding, no NaN at bucketCount > samples); Playwright: demo clip → waveform painted (canvas non-blank via pixel sampling), 5-min synthetic source overview paints < 1 s (perf gate, timing-rAF assertion); both locales; console clean.

- [ ] Commit `feat(F02): waveform overview and detail canvases`

### Task 2: Zoom / pan / selection interactions

**Files:** Create `apps/web/src/features/waveform/{interactions.ts,useZoomReducer.ts}`; register the `waveformRange` op in the worker op table (Plan-01 table + rpc type); wire into the detail canvas; keyboard shortcuts per F18-lite (this wave: arrows + brackets, documented in tooltips).

**Interfaces:**
- `useZoomReducer`: actions zoomInAt/zoomOut/panBy/setRange; clamps to sample extent; recalculated `windowSampleRange` registers the `waveformRange` op (same buckets util, parametrized by sample range — Files below) so high zoom re-buckets in the worker at < 16 buckets/pixel only.
- Selection: pointer drag + keyboard; selection lives only in the store (single truth across tools); ARIA: slider role with translated labels, arrows move/shift-extend (reduced-motion: no smooth animations, plain steps).
- Playhead subscription: playback position draws on both panels via rAF (no React re-render per frame; canvas overlay layer).

**Tests:** reducer math (clamp, direction-safety, zoom past 1-sample floor); selection keyboard matrix; Playwright: drag-select asserts selection readout text (translated), zoom buttons change the visible range label; no console errors, RTL (fa) drag boundaries (logical `start/end` handles, not left/right).

- [ ] Commit `feat(F02): selection zoom pan interactions with keyboard access`

### Task 3: Progressive spectrogram op + canvas

**Files:** Create `packages/dsp/src/fourier/spectrogramTiles.ts` — NEW pure function over the dsp barrel: computes a `rowChunkCount`-chunked STFT dB map per AGENTS §11 header (reuses plan-01 `stft` + `windows`; no per-col allocation); test file; worker op `spectrogramTiles({windowFamily, windowLengthSamples, hopFraction, dbRange, axisMode, rowChunk}); create `apps/web/src/features/spectrogram/{spectrogramView.tsx,paintSpectrogram.ts,workerJob.ts}`; controls panel: window family select (hann/hamming/blackman/rect/kaiser), window length (256..8192 pow2), hop fraction (25|50|75 %), dB range slider, axis linear/log toggle, colormap select (viridis | gray | viridisCB colorblind-safe), units labels.

**Interfaces:**
- Op streams `{rowStart, colCount, rows: Float32Array (dB, row-major), meta}` per chunk; browser paints chunks as they land into an offscreen tile cache; done → full-canvas blit; canvas column budget stays ≤ device DPR px wall (painted columns ≤ 8192 per row; wider windows downsample with a documented decimation factor and an honesty label).
- dB map: `20·log10(|X|/peakRef)` with peakRef fixed per call (`1` for absolute dB; documented); NaN/Inf → `-Infinity` clamped to dB floor.
- Feature side: derived cache hit by `(inputHash, params)`; params change → cancel old job; Playwright perf: demo clip first tiles < 3 s (gate), cancel test (rapid slider changes paint only last params), toolpage screenshot both locales.

**Tests:** dsp golden-lite for `spectrogramTiles` (tiny sine → single dominant column; window param changes practical values; axis log hybrid handled browser-side — op stays linear, browser maps indexes); no worker retention (op handler has no module-scope frame cache; code-review-level assert); Playwright console-error-zero both locales.

- [ ] Commit `feat(F02): progressive spectrogram with window and axis controls`

### Task 4: Polish, A/B slot, perf gate broker

**Files:** Create `apps/web/src/features/waveform/{compareSlot.tsx}`; touch spectrogram + waveform for a11y warnings; `docs/PROGRESS.md` note.

**Interfaces:**
- `compareSlot`: a small canvas pair slot that renders original vs derived (mono) once derived sources appear later (wires to store; renders "-" with an explanatory label today, i18n'd).
- Colormap legend component (colorbars with min/max printed), shared `formatDb/formatS`; reduced-motion checks; focus visible sweep all controls; privacy/TTL footer untouched.
- Perf broker: a Playwright perf spec file stub accumulating the Plan-01/03 gates (`overview-first-paint <1s`, `spectrogram-first-tiles <3s`) with one assertion each, skipped when backend absent (per Wave-0 harness contract).

**Tests:** all above Playwright assertions green on CI (offline) and locally with backend still offline parity; spec pass documented in task report with measured values (not fabricated — real runs, values recorded in `docs/PROGRESS.md`).

- [ ] Commit `feat(F02): spectrogram a11y polish and compare slot`
