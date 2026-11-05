# Wave 6 Plan 03 — F18 Quality of Life

## Metadata

- Spec: [`design.md`](design.md) §8
- Depends on: plan 00
- Scope: BS.1770 loudness matching, player gain seam, theme, global shortcuts, persistence
- Out of scope: loudness normalization of exported audio, server-side preferences

## Global constraints

- Loudness math runs in the worker; the player only applies a gain value.
- A/B matching is visible and honest; no hidden normalization.
- Shortcuts never fire while typing in inputs, textareas, selects, contenteditable, or dialogs.
- Theme and preferences persist per browser only; no audio is persisted.
- Both `fa` and `en` copy is complete.
- No commit.

## Review focus

1. **BS.1770 correctness:** K-weighting, 400 ms blocks, 75% overlap, both gates.
2. **Rate independence:** 44.1/48/96 kHz validated against `ffmpeg ebur128`.
3. **Player safety:** gain is clamped to ±24 dB; original lane resets to 0 dB.
4. **Shortcut guards:** no input hijack; help dialog is keyboard operable.
5. **Theme contrast:** every token readable in light mode; plots stay LTR.

## File map

Create:
- `packages/dsp/src/metrics/loudness.ts`
- `packages/dsp/test/metrics/loudness.test.ts`
- `tools/golden/src/avalab_golden/algorithms/loudness.py`
- `tools/golden/tests/test_loudness.py`
- `packages/dsp/test-data/golden/loudness.json` (generated)
- `apps/web/src/session/ops.loudness.test.ts`
- `apps/web/src/features/player/useLoudnessMatch.ts`
- `apps/web/src/features/player/useLoudnessMatch.test.ts`
- `apps/web/src/features/player/loudnessMath.ts`
- `apps/web/src/features/player/loudnessMath.test.ts`
- `apps/web/src/app/theme.ts`
- `apps/web/src/app/theme.test.ts`
- `apps/web/src/app/useTheme.ts`
- `apps/web/src/app/useGlobalShortcuts.ts`
- `apps/web/src/app/useGlobalShortcuts.test.ts`
- `apps/web/src/app/ShortcutHelpDialog.tsx`
- `apps/web/e2e/theme.spec.ts`
- `apps/web/e2e/shortcuts.spec.ts`

Modify:
- `packages/dsp/src/index.ts`
- `apps/web/src/session/ops.ts`
- `apps/web/src/workers/dsp.worker.ts`
- `apps/web/src/features/player/transport.ts`
- `apps/web/src/features/player/transport.test.ts`
- `apps/web/src/features/player/usePlayer.ts`
- `apps/web/src/features/player/player.tsx`
- `apps/web/src/app/layout.tsx`
- `apps/web/src/styles/app.css`
- `apps/web/src/i18n/en.json`
- `apps/web/src/i18n/fa.json`
- `apps/web/src/features/generator/generatorView.tsx` and other tools lacking persistence
- `docs/ALGORITHMS.md`
- `docs/DECISIONS.md`
- `docs/THIRD_PARTY.md` (no new dependency expected)
- `docs/PROGRESS.md`

## Task 1 — BS.1770 DSP and golden vectors

**Files:** `packages/dsp/src/metrics/loudness.ts`, tests, golden generator, index

1. Define:
   ```ts
   export interface LoudnessParams {
     readonly sampleRateHz: number;
   }
   export interface LoudnessBlock {
     readonly startSample: number;
     readonly durationSeconds: number;
     readonly loudnessLufs: number;
     readonly absoluteGated: boolean;
     readonly relativeGated: boolean;
   }
   export interface LoudnessResult {
     readonly integratedLufs: number;
     readonly blocks: readonly LoudnessBlock[];
     readonly blockDurationSeconds: number;
     readonly blockHopSeconds: number;
   }
   export function measureLoudness(samples: Float32Array, params: LoudnessParams): LoudnessResult;
   export function kWeightingCoefficients(sampleRateHz: number): {
     readonly shelf: { readonly b: readonly number[]; readonly a: readonly number[] };
     readonly highpass: { readonly b: readonly number[]; readonly a: readonly number[] };
   };
   export function loudnessGainDb(originalLufs: number, processedLufs: number): number;
   ```
2. 48 kHz coefficients exactly:
   - Shelf: `b = [1.53512485958697, -2.69169618940638, 1.19839281085285]`,
     `a = [1, -1.69065929318241, 0.73248077421585]`.
   - High-pass: `b = [1, -2, 1]`,
     `a = [1, -1.99004745483398, 0.99007225036621]`.
3. Other rates: derive coefficients with the standard bilinear transform from the analog prototype. Keep the derivation in one function; do not interpolate the 48 kHz numbers.
4. Filter with two cascaded biquads in Float64. Use `-0.691 + 10 log10(mean square)` per block. 400 ms blocks, 75% overlap. Absolute gate at `-70 LUFS`; relative gate at `ungatedMean - 10 LU`. `integratedLufs` from blocks passing both gates; silence returns `-Infinity` (documented).
5. `loudnessGainDb` returns `clamp(original - processed, -24, 24)`; non-finite returns 0.
6. Golden generator `loudness.py`:
   - Cases: 1 kHz sine at `-20 dBFS`, silence, two-level signal (loud then quiet) to exercise relative gating, 44.1 kHz and 96 kHz versions.
   - `cases()` computes expected with NumPy and writes the same formulas.
7. Tests:
   - Golden values within `1e-6` (Float64 path).
   - Known-level check: 1 kHz sine at `-20 dBFS` within `0.5 LU` of `-20` for mono.
   - Silence returns `-Infinity` integrated and finite block count.
   - Gating: a quiet block 15 LU below the loud block is excluded.
   - Invalid rate, empty input, and non-finite samples throw typed errors.
8. Optional cross-check test: if `ffmpeg` is installed, encode the same sine to WAV and compare `ebur128` integrated loudness within `0.2 LU` at 44.1/48/96 kHz; skip with a clear message when unavailable.
9. Run `pnpm gen:golden`, `uv run --directory tools/golden pytest -q tests/test_loudness.py`, `pnpm --filter @avalab/dsp exec vitest run test/metrics/loudness.test.ts`.

## Task 2 — Worker op and gain math

**Files:** `ops.ts`, `dsp.worker.ts`, `ops.loudness.test.ts`, `loudnessMath.ts`, tests

1. Add `loudnessMeasure` op:
   - Params `{ sampleRateHz: number }`.
   - Payload: mono Float32 samples.
   - Result `{ integratedLufs: number; blockCount: number; blockDurationSeconds: 0.4; blockHopSeconds: 0.1; blocks: { startSample: number; loudnessLufs: number; absoluteGated: boolean; relativeGated: boolean }[] }`.
   - Reject empty payload, non-finite samples, and >300 s.
2. `loudnessMath.ts`:
   ```ts
   export function matchGainDb(originalLufs: number, processedLufs: number): number;
   export function formatLufs(value: number): string; // "-23.0 LUFS" or "—"
   ```
   Reuse the DSP helper for the clamp; keep UI formatting separate.
3. Tests:
   - Op returns the same integrated value as the DSP function and the same block gating flags.
   - Op rejects a bad payload and >300 s.
   - Gain clamp at `-24`, `+24`, and non-finite.
4. Run `pnpm --filter @avalab/web exec vitest run src/session/ops.loudness.test.ts src/features/player/loudnessMath.test.ts`.

## Task 3 — Player GainNode seam

**Files:** `transport.ts`, `transport.test.ts`, `usePlayer.ts`, `player.tsx`

1. Extend `TransportContext`:
   ```ts
   createGain?(): TransportGain;
   ```
   `TransportGain = { gain: { value: number }; connect(destination: unknown): void; disconnect(): void }`.
2. Extend `TransportNode` with `connect(destination: unknown): void`.
3. Extend `Transport` with `setGainDb(gainDb: number): void; readonly gainDb: number;`.
4. In `createTransport`:
   - Lazily create one gain node when `context.createGain` exists; connect it to `context.destination`.
   - Route the plan-00 source connection through the gain node; when gain is unavailable, keep the direct `context.destination` connection.
   - `setGainDb` clamps to `[-24, 24]`, ignores non-finite, sets `gain.value = 10 ** (db / 20)`.
   - `setGainDb(0)` resets exactly.
   - Dispose disconnects the gain node.
5. Fake context tests:
   - Source connects to gain, gain connects to destination.
   - Without gain, the source connects directly to destination (regression for the missing playback connection).
   - `setGainDb(-6)` sets linear `0.501187...`; non-finite is a no-op.
   - Original lane reset does not affect playback state.
   - Node teardown still leaves one live node.
6. `usePlayer`:
   - Expose `gainDb`, `setGainDb`.
   - On `activeKind` or `active` change, call `machine.setGainDb(0)`; the loudness hook applies the match after measurement.
7. Run `pnpm --filter @avalab/web exec vitest run src/features/player/transport.test.ts`.

## Task 4 — Loudness-matched A/B

**Files:** `useLoudnessMatch.ts`, tests, `player.tsx`, i18n

1. `useLoudnessMatch(player)`:
   - State `enabled` persisted at `avalab.loudnessMatch` (`"1"`/`"0"`).
   - When enabled, active lane is processed, and both lanes exist, call `deriveStandalone("loudnessMeasure", ...)` for both lanes with copied payloads.
   - Use a request-generation guard so stale measurements cannot apply.
   - Compute `gainDb = matchGainDb(original.lufs, processed.lufs)`; call `player.setGainDb(gainDb)`.
   - When disabled or active lane is original, call `player.setGainDb(0)`.
   - Expose `{ enabled, toggle, gainDb, originalLufs, processedLufs, status }`.
2. Player UI:
   - Checkbox/button with `data-testid="player.loudnessMatch"`.
   - Readout `data-testid="player.loudnessGain"` in `dir="ltr"`, e.g. `+3.2 dB`.
   - Honest label: "Loudness match (BS.1770)" and hint that it changes only playback gain.
3. Tests with a fake store/worker:
   - Enabled + processed → gain applied.
   - Switching to original → 0 dB.
   - Disabled → 0 dB.
   - Stale measurement from a previous processed source is ignored.
   - Non-finite LUFS yields 0 dB.
4. Run `pnpm --filter @avalab/web exec vitest run src/features/player/useLoudnessMatch.test.ts`.

## Task 5 — Theme

**Files:** `theme.ts`, `useTheme.ts`, `app.css`, `layout.tsx`, tests, e2e

1. `theme.ts`:
   ```ts
   export type Theme = "dark" | "light" | "system";
   export const THEME_STORAGE_KEY = "avalab.theme";
   export function readStoredTheme(storage?: Pick<Storage, "getItem">): Theme;
   export function resolveTheme(theme: Theme, prefersLight: boolean): "dark" | "light";
   export function writeStoredTheme(theme: Theme, storage?: Pick<Storage, "setItem">): void;
   ```
   Total decode: unknown/missing => `"system"`.
2. `useTheme`:
   - Apply `data-theme="dark" | "light"` to `document.documentElement`.
   - `system` listens to `matchMedia("(prefers-color-scheme: light)")` and updates on change.
   - Persist on change; no source audio.
3. `app.css`:
   - Keep dark tokens as default.
   - Add `[data-theme="light"]` overrides for `--color-bg`, `--color-surface`, `--color-text`, `--color-muted`, `--color-accent`; `color-scheme: light`.
   - Verify surface/border/plot colors meet contrast; spectrogram colormaps stay unchanged.
4. Layout header gets a theme select (`system`, `light`, `dark`) with translated labels.
5. Tests:
   - `readStoredTheme` fallbacks.
   - `resolveTheme` for all six combinations.
   - `useTheme` writes `data-theme` and persists (DOM-free test via injected document adapter; or test the pure helpers plus e2e).
6. `theme.spec.ts`: switch to light, reload, assert `data-theme=light`; switch back to system; no console errors; run in `fa` and `en`.

## Task 6 — Global shortcuts and help

**Files:** `useGlobalShortcuts.ts`, `ShortcutHelpDialog.tsx`, `layout.tsx`, `player.tsx`, tests, e2e

1. Add `isEditableTarget(target: EventTarget | null): boolean`:
   - true for `input`, `textarea`, `select`, `[contenteditable="true"]`, and `[role="dialog"]` descendants.
2. `useGlobalShortcuts({ player, onShowHelp })`:
   - `Space` toggles play/pause; prevent default only when not editable and a source exists.
   - `ArrowLeft`/`ArrowRight` seek `∓5 s`/`±5 s`; with Shift `∓10 s`/`±10 s`.
   - `?` opens help.
   - Ignore `event.repeat`, modifier keys other than Shift, and editable targets.
3. `ShortcutHelpDialog`: accessible `role="dialog"`, `aria-modal`, focus trap, Escape closes, translated key table.
4. Layout owns `helpOpen`; `PlayerDock` receives `onShowHelp` and calls the hook.
5. Tests:
   - Editable guard for input/textarea/select/contenteditable/dialog.
   - Space/arrow mappings.
   - `?` opens, Escape closes.
   - Shortcuts do nothing without a source.
6. `shortcuts.spec.ts`: play/pause, seek, input guard, help dialog, in both locales.

## Task 7 — Persist last-used settings

1. Audit tools without persistence: generator, speed, sampling, extent, reverb, spectrum edit, codec lab, metrics, AI, filters (already), pipeline (plan 02), psychoacoustics (plan 01).
2. Use the existing URL/localStorage pattern in each state module; storage keys `avalab.<tool>.last`.
3. Persist only serializable parameters; never source audio, file names, or AI results.
4. Add a shared helper only if three or more tools need identical safe storage; otherwise keep local patterns.
5. Tests: reload persists settings for generator, speed, reverb, codec lab; invalid stored JSON falls back to defaults.
6. Run `pnpm check`.

## Task 8 — Documentation and acceptance

1. Add BS.1770 formulas, coefficients, gates, and limitations to `docs/ALGORITHMS.md`.
2. Add F18 decisions to `docs/DECISIONS.md`: gain seam, clamp, theme storage, shortcut map.
3. Run `pnpm check`, `pnpm --filter @avalab/web e2e -- theme.spec.ts shortcuts.spec.ts`.
4. Update `docs/PROGRESS.md`; do not commit.
