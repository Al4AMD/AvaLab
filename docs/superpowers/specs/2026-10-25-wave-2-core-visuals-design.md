# Wave 2 — Core visuals: design spec

> Approved in chat 2026-10-25 (owner). Carries F01/F02/F08/F12 UI onto the shell from
> Wave 0 and the `packages/dsp` library from Wave 1. Parent roadmap:
> `docs/plans/README.md`; style rules: `AGENTS.md` §5–§10, §17.

## 1. Outcome

A student loads an audio source and, in the browser, sees a waveform and a
spectrogram, can select/zoom/pan a time region, can inspect magnitude/phase of the
Fourier transform of the selection, and can synthesize a signal as a session source
— all bilingually (fa RTL default / en LTR), all without the API when the API is
unreachable (offline lane), with live playback through the dock player.

Success criteria (from AGENTS §9 + this spec):
- 5-min 48 kHz mono file: waveform overview first paint < 1 s; progressive
  spectrogram first tiles < 3 s; worker only (main thread runs no DSP).
- Every tool page: zero console errors (Playwright assertion), bilingual keys
  parity enforced by `pnpm i18n:check`, plots forced `dir="ltr"`.
- Panning/zoom/selection stays < 16 ms frame budget via cached typed-array paints.

## 2. Architecture

### 2.1 Layers (apps/web/src additions)

```
app/        routes: layout shell (sidebar nav + docked player) + /tools/<tool>
session/    zustand store: §10 audio session; rpc.ts typed-message client
workers/    dsp.worker.ts — long-lived module worker, pure typed messages
features/
  input/       F01 upload (dropzone), demo clips, mic recording, generator handoff
  waveform/    F02 overview+detail canvases, zoom/pan/selection, playhead
  spectrogram/ F02 progressive tiles + controls
  fftview/     F08 magnitude/phase of the selection (uPlot)
  generator/   F12 generator panel (dsp generators) → session source
```

Names carry units (`windowLengthSamples`, `sampleRateHz`, `cutoffHz`) per AGENTS
§10; no component computes DSP itself — views are thin painters over results.

### 2.2 Session store (Zustand) — the §10 contract

State: `original` (immutable `{samples: Float32Array, sampleRateHz, name, sourceKind}`
or null), `derived: Map<string, {result, key}>`, `jobs: Map<key, {progressPct |
null, cancel?}>`, `selection: {startSample, endSample}`, `backendOnline: boolean`.

Actions: `loadBackend(file | recording)`, `loadOffline(file | demoClipId)`,
`loadGenerated(params)`, `derive(op, params)`, `cancel(jobKey)`,
`setSelection(...)`. Derived cache key = `op + canonicalJson(params) + inputHash`
(input hash = FNV-1a 64 over the PCM bytes, `packages/dsp/src/utils/hash.ts`, unit
-tested; cache empty on new source). Cache is per-viewer only (no persistence).

Derived results are plain data (`{samples?, points?, meta}`) — tools are pure
functions of (input, params) per AGENTS §10; UI holds no DSP logic.

### 2.3 DSP worker + typed RPC (D-018; no Comlink)

- Worker: `new Worker(new URL("../workers/dsp.worker.ts", import.meta.url), {type:"module"})`.
- Request `{id: number, op: string, params: object, payload?: transferable}` →
  Response `{id, ok: true, result: {data: typed-array | object, meta}}` or
  `{id, ok: false, error: {code, message}}`. All typed-array payloads transferred,
  never copied (structured clone of 5-min buffers is the §9 risk).
- Cancel: `cancel(id)` marks the id superseded; the worker checks between op
  stages and exits early. Late frames for superseded ids are dropped silently.
- Worker surface importable as plain functions for Vitest (the RPC layer is a
  thin adapter around the same op table). Adding an op = one entry in the op
  table + one RPC type in `session/rpc.ts` (`DspOpRequest` discriminated union).
- Initial ops (W2-01): `sessionPing`, `waveformOverview` (peak buckets). Later
  plans add spectrogram/FFT/generator ops; nothing else may use the worker from
  view code (purge ad-hoc worker spawns).

### 2.4 Audio acquisition (F01) — D-018 companion ruling

Backend-first with an offline fallback lane:

1. Upload/record → `POST /api/v1/ingest` → canonical WAV → `GET /audio/{id}`
   → `decodeAudioData` (browser) → Float32 mono analysis + stereo playback kept.
   Backend errors map by code to translated messages; 5-min/100 MB limits are
   the backend's truth (client pre-checks size only as a courtesy).
2. Offline lane (`backendOnline === false`, detected on first failed call):
   `File → decodeAudioData` directly (WAV/MP3/OGG whatever the platform decodes)
   and the three bundled demo clips. UI shows which lane is active.
3. Generator: dsp generators via worker → session source (no file).
   Analysis is mono downmix by default (playback keeps channels) per F01.

### 2.5 Routing + URL state (D-015 resolved, D-019)

`react-router` (v7 data APIs), routes: `/` → redirect `/tools/waveform`,
`/tools/waveform|spectrogram|fftview|generator`. Tool params serialize into the
query string (`?win=hann&w=1024&hop=256&db=-100..0`) via a per-tool
`paramsToSearch/searchToParams` pair; only serializable params ride the URL —
never user audio (F16 groundwork). Primary controls are computed state, not
URL-first (mutation of the URL per slider would thrash history): URL updates are
debounced `history.replaceState`.

### 2.6 Rendering

Waveform/spectrogram = Canvas 2D (WebGL2 only if §9 budgets miss, D-006 rules);
OffscreenCanvas only if profiling demands it. Charts with library-grade
handles (FFT magnitude/phase) = uPlot. Every plot: `dir="ltr"` wrapper, axis
units (Hz / s / dB), number formatting via a tiny shared `formatHz/formatS`
helper (Latin digits in technical readouts, AGENTS §6).

### 2.7 Playback (F01/F06 split)

Dock player = `AudioContext` + `AudioBufferSourceNode` (audio-engine work, not
DSP): play/pause, seek (±5/±10 s), selection-loop toggle reserved. Speed modes
and time-stretch arrive Wave 3 (F06) — the player contract keeps a
`playbackRate` seam now so F06 plugs in without rework. Live meters use
AnalyserNode (AGENTS §3) — deferred to the speed waves, not Wave 2.

## 3. Dependencies (only these)

`react-router` (routing, D-015), `zustand` (§10 store), `uplot` (analytical
charts). Versions: caret at install time, exact-pinned in lockfiles; recorded in
`docs/THIRD_PARTY.md`. Nothing else — no Comlink (D-018), no d3, no chart
runners, no worker libs.

## 4. Testing & verification

- Unit (Vitest, `pnpm --filter @avalab/web test`): RPC adapter with
  `MessageChannel` (no real Worker in jsdom), store transitions + cache + jobs,
  bucketing/tiling pure functions, hash, params↔URL codecs.
- Playwright (`pnpm e2e`, API-offline harness per Wave 0): per-tool smoke —
  load a demo clip, exercise the tool, zero console errors, screenshot on fail.
  API-present path smoke-tested manually + conditional-gated spec when backend
  runs (docker compose up) — same pattern as Wave 0 health spec.
- Performance gates (§9): timing assertions in the Playwright perf spec
  (overview < 1 s, first spectrogram tiles < 3 s on the 5-s demo clip scaled to
  representative bucket counts; full 5-min check runs when backend is present).
- `pnpm check` gates i18n parity + unused keys on every commit (already wired).
- Accessibility baseline (AGENTS §9): every control keyboard-operable with
  visible focus and translated ARIA labels; `prefers-reduced-motion` respected
  (progressive tiles may animate only with a reduced-motion fallback of static
  completion); never color-only information (two colormaps incl. a
  colorblind-safe one in W2-03, units always printed).

## 5. Deferred (recorded, not forgotten)

mel frequency axis + colormaps beyond 2 (W2-04+, F02), speed modes/time-stretch
UI (Wave 3, F06), before/after A/B overlay activation (Wave 3+ when a derived
source exists; canvas slot designed now), fourier-series harmonic rebuild UI
(F12 P1 remainder, Wave 4+), butterfly step-through (F08 deep, Wave 5),
live meters (AnalyserNode) alongside F06.

## 6. Risks

- Worker memory: whole-file frame stores are the Wave 1 lesson (0.9 GB PV);
  spectrogram tiles + bucketing derive eagerly-discardable intermediates only.
- decodeAudioData codec variance across browsers for the offline lane is
  documented in UI copy ("offline lane: browser codecs"), not treated as a bug.
- uPlot's RTL neutrality: wrapped in `dir="ltr"` container + logical margins.
