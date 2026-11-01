# Wave 3 · Plan 01 — Processed playback lane and F06 speed/direction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The session can hold a processed audio source beside the immutable original, the dock player A/B-switches between them without losing the playhead, and a new `/tools/speed` lab demonstrates F06 resampling vs phase-vocoder speed, pitch shift, and reverse.

**Architecture:** Spec §2.2 store contract + §2.7 player. Add one store-owned `processed` lane (not a derived-cache entry: audio buffers need ownership and lifetime, not params-keyed caching). F06 is a tool page that computes a full processed buffer in the worker and hands it to the lane; playback stays rate 1. `playbackRate` in `transport.ts` remains the documented future seam, unused.

**Tech Stack:** As Wave 2. New deps: none.

**Spec:** `AGENTS.md` §9 (memory, workers), §10 (pure tools), F06; `docs/superpowers/specs/2026-10-25-wave-2-core-visuals-design.md` §2.2, §2.7; `docs/DECISIONS.md` D-022.

## Global Constraints

- DSP only in the worker; views are parameter plumbing and painting.
- `packages/dsp` stays pure/deterministic/DOM-free.
- TypeScript strict, no `any`; units in names (`speedFactor`, `sampleRateHz`).
- All user-visible strings through i18n; `en.json` and `fa.json` parity; fa copy machine-drafted and flagged for owner review.
- Logical CSS properties only; plots wrapped `dir="ltr"`; Latin digits in technical readouts.
- `pnpm check` and `pnpm e2e` green before the plan closes; e2e runs both locales with zero console errors.
- No new dependencies.

## Review Focus

1. **Memory cap honesty** — a processed buffer can exceed the 300 s source cap (slow time-stretch). The store must reject `durationSeconds > 300` with a typed code and the UI must say why; never silently truncate. (§9)
2. **A/B continuity** — switching original↔processed while playing must keep the same time position (clamped) and keep playing; it must never restart at 0 or leave two live nodes. (§2.7, F18 groundwork)
3. **Pitch semantics** — resample mode changes speed AND pitch (tape); time-stretch changes speed only; pitch-shift keeps duration. Tests pin dominant-frequency direction, not just length.
4. **Preview bounds** — live preview applies to the selection or first 30 s; “apply to whole file” is explicit. A 5-min phase-vocoder run must not start on a slider tick.
5. **i18n/RTL** — speed presets/custom input, mode labels, reverse toggle, cap notice, and processed lane badge all translated; the speed page mirrors under RTL and stays LTR for numeric readouts.

---

### Task 1: Store processed lane

**Files:**
- Modify: `apps/web/src/session/store.ts`
- Modify: `apps/web/src/session/store.test.ts`

**Interfaces:**
- `export type PlaybackMode = "original" | "processed";`
- `export type ProcessedSource = { readonly samples: Float32Array; readonly sampleRateHz: number; readonly label: string };`
- `export type ProcessedErrorCode = "invalidType" | "notFinite" | "rateTooHigh" | "tooLong" | "empty";`
- `export type SetProcessedResult = { ok: true } | { ok: false; code: ProcessedErrorCode };`
- `export const MAX_PROCESSED_SECONDS = 300;`
- State adds `readonly processed: Readonly<ProcessedSource> | null; readonly playbackMode: PlaybackMode;`
- Actions:
  - `setProcessed(samples: Float32Array, sampleRateHz: number, label: string): SetProcessedResult` — validates finite samples, positive finite rate, non-empty, `samples.length / sampleRateHz <= MAX_PROCESSED_SECONDS`; takes ownership (no copy); sets `playbackMode: "processed"` on success.
  - `clearProcessed(): void` — clears processed and sets mode `"original"`.
  - `setPlaybackMode(mode: PlaybackMode): void` — unknown mode is a `TypeError` (app bug); `"processed"` with no processed source is a no-op.
- `loadSource` success clears `processed` and resets `playbackMode` to `"original"`.
- Export pure selector `selectPlaybackSource(state: Pick<SessionState, "original" | "processed" | "playbackMode">): Readonly<SessionSource | ProcessedSource> | null` — processed only when mode is processed AND processed exists; otherwise original.

- [x] **Step 1: Write failing store tests** in `store.test.ts` for: setProcessed happy path (mode flips, samples identity preserved), empty rejected, non-finite sample rejected, rate ≤ 0 rejected, >300 s rejected, clear resets, loadSource resets, `setPlaybackMode("processed")` no-op without processed, `selectPlaybackSource` fallback.
- [x] **Step 2: Run** `pnpm --filter @avalab/web test -- store.test` — expected FAIL (`setProcessed` absent).
- [x] **Step 3: Implement** the lane exactly as the Interfaces block; reuse the existing finite-sample scan style from `loadSource`.
- [x] **Step 4: Run** the same command — expected PASS.
- [x] **Step 5: Commit** `feat(F06): add processed playback lane to the session store`.

### Task 2: Worker op `speedTransform`

**Files:**
- Modify: `apps/web/src/session/ops.ts`
- Modify: `apps/web/src/session/ops.test.ts`
- Modify: `apps/web/src/workers/dsp.worker.ts`

**Interfaces:**
- `export type SpeedTransformParams = { sampleRateHz: number; startSample: number; endSample: number; mode: "resample" | "timeStretch"; speedFactor: number; semitones: number; reverse: boolean };`
- `export type SpeedTransformResult = { meta: { outputSampleCount: number; sampleRateHz: number; actualSpeedFactor: number; elapsedMs: number; capped: boolean }; payload?: TransferablePayload };`
- Handler receives the source slice payload (Float32).
- Resample mode: `outputRateHz = Math.round(sampleRateHz / speedFactor)`; reject `outputRateHz < 1`; `resampleRational(x, { inputRateHz, outputRateHz, filter: "kaiserSinc" })`; `actualSpeedFactor = inputRateHz / outputRateHz`.
- Time-stretch mode: `timeStretch(x, { stretchFactor: 1 / speedFactor, windowLengthSamples: 2048 })`; if `semitones !== 0`, then `pitchShift(stretched, { semitones, windowLengthSamples: 2048, sampleRateHz })`.
- Reverse: `reverse(output)` last.
- Output duration > `MAX_PROCESSED_SECONDS` → `DspOpError("tooLong", …)`.
- Convert result to `Float32Array`; return transferred payload and `elapsedMs` from `performance.now()`.
- `speedFactor` finite in `[0.25, 4]`, `semitones` finite in `[-12, 12]`, `startSample/endSample` valid integers; else `badParams`.

- [x] **Step 1: Write failing op tests** in `ops.test.ts`: 1 s 440 Hz sine at 48 kHz → resample 2× yields ~24 000 samples and FFT peak near 880 Hz; time-stretch 2× yields ~96 000 samples and peak stays 440 Hz; pitch-shift +12 semitones keeps length and peak near 880 Hz; reverse of a ramp is descending; 5-min × 0.5× throws `tooLong`; bad speed throws `badParams`.
- [x] **Step 2: Run** `pnpm --filter @avalab/web test -- ops.test` — expected FAIL.
- [x] **Step 3: Implement** the handler and add the one worker dispatch case.
- [x] **Step 4: Run** the test — expected PASS.
- [x] **Step 5: Commit** `feat(F06): add speed transform worker op`.

### Task 3: Player A/B and playhead continuity

**Files:**
- Modify: `apps/web/src/features/player/usePlayer.ts`
- Modify: `apps/web/src/features/player/player.tsx`
- Modify: `apps/web/src/features/player/transport.ts` only if a helper is needed (no rate change)
- Test: `apps/web/src/features/player/transport.test.ts` (pure helper) and a new `apps/web/src/features/player/usePlayer.test.ts` only if a pure mapper is extracted; otherwise cover in e2e.

**Interfaces:**
- `PlayerApi` adds `readonly activeKind: "original" | "processed"; readonly hasProcessed: boolean; readonly setPlaybackMode: (mode: PlaybackMode) => void;`
- `usePlayer` subscribes `original`, `processed`, `playbackMode`; computes `active = selectPlaybackSource(...)`.
- Source-swap effect: capture `wasPlaying` and `seconds = currentSample / sampleRateHz` before `setSource`; after `setSource`, `seekToSample(clamp(round(seconds * newRateHz), 0, lengthSamples - 1))`; if `wasPlaying`, `play()`.
- Dock adds a two-button A/B group (`player.ab.original`, `player.ab.processed`), processed button disabled when `!hasProcessed`, and a reset action (`player.reset`) that calls `clearProcessed`. Keep the existing source-kind lane badge for the original and show `player.lane.processed` when active.

- [x] **Step 1: Write a failing unit test** for the pure seconds→sample mapping helper (`mapPlayheadSeconds(seconds, targetRateHz, targetLengthSamples)`) in `transport.test.ts` or a new `playback.test.ts`: rate change, clamp at 0 and end, non-finite → 0.
- [x] **Step 2: Run** `pnpm --filter @avalab/web test -- playback` — expected FAIL.
- [x] **Step 3: Implement** the helper, `usePlayer` swap effect, and dock A/B controls.
- [x] **Step 4: Run** web tests — expected PASS.
- [x] **Step 5: Commit** `feat(F06): A/B processed playback with playhead continuity`.

### Task 4: F06 speed/direction page

**Files:**
- Create: `apps/web/src/features/speed/{speedState.ts,speedState.test.ts,speedView.tsx}`
- Modify: `apps/web/src/app/routes.tsx`, `apps/web/src/app/sidebar.tsx`, `apps/web/src/app/routes.test.tsx`
- Modify: `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fa.json`
- Create: `apps/web/e2e/speed.spec.ts`

**Interfaces:**
- URL codec keys: `sp` (speedFactor), `m` (`resample` | `timeStretch`), `p` (semitones), `rv` (`0` | `1`), `from`/`to` (sample range). Decoder clamps and falls back per field.
- Defaults: mode `resample`, speed `1`, semitones `0`, reverse off, range = full source.
- Preview range: current selection when non-empty, else first `min(30 s, source length)`; “apply to whole file” sets range to full source.
- Controls: mode toggle, speed presets `[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]` + custom number input, semitone input (disabled in resample mode), reverse checkbox, apply-scope buttons.
- On debounce (200 ms): copy the selected slice, call `deriveStandalone("speedTransform", params, payload)`, convert payload to `Float32Array`, call `setProcessed(..., "speed")`.
- Result panel: waveform mini-canvas + spectrogram via `deriveStandalone("spectrogramTiles", params, copiedProcessedPayload)`; show output duration and actual speed; `tooLong`/cap notice translated.
- Route `/tools/speed`; `TOOL_IDS` adds `"speed"`; sidebar link.

- [x] **Step 1: Write failing `speedState.test.ts`** for encode/decode round-trip, invalid values fall back, range clamp, and preview-range selection.
- [x] **Step 2: Run** `pnpm --filter @avalab/web test -- speedState` — expected FAIL.
- [x] **Step 3: Implement** state codec + view + route/sidebar + i18n keys (`speed.*`, `nav.speed`).
- [x] **Step 4: Run** `pnpm check` — expected PASS.
- [x] **Step 5: Write e2e** `speed.spec.ts`: load demo clip; choose 2×; wait for processed badge; result spectrogram canvas non-blank; toggle reverse; assert `player.ab.processed` pressed; switch locale with init script and assert LTR + no console errors.
- [x] **Step 6: Run** `pnpm e2e -- speed` (after `vite build` if invoking Playwright directly) — expected PASS.
- [x] **Step 7: Commit** `feat(F06): speed and direction lab`.

### Task 5: Compare slot activation and close-out

**Files:**
- Modify: `apps/web/src/features/waveform/compareSlot.tsx`
- Modify: `docs/PROGRESS.md`, `docs/plans/wave-3/README.md`, `docs/DECISIONS.md`, `docs/ALGORITHMS.md`

**Interfaces:**
- Compare slot right pane renders the processed waveform when `processed` exists: copy `processed.samples`, run `deriveStandalone("waveformOverview", { bucketCount: 200, sampleRateHz }, payload)`, paint with `paintWaveform`; otherwise keep the translated dash.
- Add `D-022` recording: processed lane ownership, 300 s cap, A/B playhead mapping, transport rate seam still pinned.
- `ALGORITHMS` row for `speedTransform`: composition of `resampleRational`, `timeStretch`, `pitchShift`, `reverse`; no new math.

- [x] **Step 1: Implement** compare-slot processed pane.
- [x] **Step 2: Run** `pnpm check` and `pnpm e2e` — expected PASS; record measured numbers in `PROGRESS`.
- [x] **Step 3: Update** docs and mark plan 01 done in `wave-3/README.md`.
- [x] **Step 4: Commit** `docs(F06): close processed playback and speed plan`.

## Shipped (2026-11-01)

- Store-owned processed lane (`setProcessed`/`clearProcessed`/`setPlaybackMode`, `selectPlaybackSource`, typed errors, 300 s cap, `loadSource` reset); `speedTransform` worker op (tape resample, pitch-preserving time-stretch, optional pitch shift, reverse); dock A/B with last-playable-sample continuity; `/tools/speed` URL/state/view with presets, custom speed, semitones, reverse, preview/whole-file apply, result waveform + spectrogram, and compare-slot processed pane.
- Semantics pinned by D-022: `speedFactor > 1` is faster; resample changes speed and pitch; time-stretch changes speed only; output above 300 s is rejected, never truncated; `transport.ts` playbackRate remains an unused seam. The Task 2 `~96 000`-sample time-stretch expectation inverted the pinned semantics; tests pin ~24 000 samples with pitch preserved.
- Audit close-out fixed the player source-swap clamp at the last playable sample so swapping lanes at the end does not restart at zero, and corrected the selection readout to use the original source rate instead of the active lane rate.
- Gates after audit: `pnpm check` exit 0 (dsp 951/951, web 286/286, scripts 13/13, i18n OK, biome 188 files); `pnpm e2e` 37/37 with zero console errors in fa + en. Perf on that run: overview first paint 396 ms (< 1000 ms), spectrogram first tiles 495 ms (< 3000 ms).
- Carries: `speed.*` and `player.*` Persian copy needs owner review; the processed lane is intentionally not cached/evicted; the compare slot's original pane still renders the honest dash.
- **Next step:** Wave 3 plan 02 — `docs/plans/wave-3/02-sampling-bit-depth.md`.
