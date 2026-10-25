# Wave 2 · Plan 04 — Fourier view (F08) and signal generator (F12)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** The Fourier view (magnitude/phase of the selection, window controls, window-compare chart) and the generator panel (dsp generators → session source) — closing Wave 2's "load → play → waveform/spectrogram/FFT" milestone (AGENTS §5 M1).

**Architecture:** Spec §2.6 (uPlot charts, `dir="ltr"` wrappers) + §2.3 (ops). Everything DSP-side already exists from Wave 1 (`fft`, `windows`, `magnitudeDb`, `unwrapPhase`, generators); this wave adds no dsp math beyond op plumbing. New dep this plan: `uplot`.

**Tech Stack:** As Plan 01–03 + `uplot` (caret at install, pinned by lockfile, THIRD_PARTY entry).

**Spec:** `AGENTS.md` §3 (uPlot), §6, §9, F08 (P0 subset: magnitude/phase/window-compare — butterfly step-through and full STFT compare stay Wave 5), F12 (generator subset; fourier-series harmonics slider stays Wave 4+).

## Review Focus

1. **FFT honesty** — displayed phase only above a magnitude threshold (AGENTS F08 mask) or explicitly labeled below-threshold noise; dB/linear conversion uses the dsp `magnitudeDb` (no reimplement); selection (from store) drives the transformed range; empty selection → whole-file op behavior documented.
2. **No main-thread DSP** — FFT/window/generator work runs via the worker op table; the fftview's own code is parameter plumbing + uPlot redraw; underscores: zero `Float64Array(2N)` math in any component.
3. **uPlot RTL discipline** — all charts in a `dir="ltr"` container; logical margins; axis titles carry units (Hz, dB, s); number formatting via the shared formatters (no locale-digit drift in readouts).
4. **Generator contract** — every widget maps to an existing dsp generator function unchanged (`generateSine`, noise, chirp, impulse, step, …); duration/frequency/amp inputs carry units in labels, are a11y-labelled, and the 5-min source cap applies like any source (`loadSource` guards); "load as source" routes through the store, never directly into the canvas.
5. **i18n/locale** — full keys both locales incl. tooltips; RTL drag boundaries use logical positions; console-error-free Playwright in both locales.

---
### Task 1: Fourier view — magnitude & phase of the selection

**Files:** Create ZERO new dsp math (use the exported `fft`/`fftReal` + `magnitudeDb` + `unwrapPhase` — wave-1 tested): register worker op `fftSelection({selection? whole, windowFamily, windowLengthSamples, dB: boolean, phaseUnits: "wrapped" | "unwrapped"})` in the op table; create `apps/web/src/features/fftview/{fftView.tsx,fftPlots.ts}` (uPlot wrappers); i18n keys `fftview.*`.

**Interfaces:**
- Op result: `{frequencyBinsHz: Float64Array, magnitudeDb: Float64Array, phase: Float64Array, meta {binCount, sampleRateHz}}` transferred; fft size = next pow2 ≥ selection length (documented + zero-padding note printed in UI; window applied before fft — plan-01 conventions).
- View: magnitude chart (dB/linear toggle), phase chart (wrapped/unwrapped toggle, magnitude-mask slider bin Count below-threshold marked "insufficient magnitude"); params serialize to URL (`url-state` codec test).
- uPlot setup: gradients off, `ms/me` spacing; legend with hover readout (Hz, dB/linear, phase rad) translated.

**Tests:** op-level (fixed synthetic selection → known dominant bin; window toggle changes leakage; whole-file fallback on empty selection); url codec round-trip; Playwright: demo clip → select region → charts render non-blank, toggles flip data, console clean both locales.

- [ ] Commit `feat(F08): fft magnitude and phase view of selection`

### Task 2: Window compare panel

**Files:** Create `apps/web/src/features/fftview/windowCompare.tsx`; worker op `windowProfiles({windowFamily(≤6), windowLengthSamples})` re-using wave-1 `windows` exports only (no new dsp).

**Interfaces:**
- Op result per window: `{name, samplesN, frequencyResponse: Float64Array (dB), mainLobeWidthHz, sideLobeLevelDb}` — mainLobe/side-lobe measured from the computed response in the op (documented formula: first-null main lobe; side lobe = max dB outside main lobe), so the dsp `windows` names remain untouched.
- View: small uPlot grid, table of windows w/ the pairing labels; tooltips referencing the F08 theory hook (F16 theory panel arrives Wave 4/5 — plain labels now).

**Tests:** op math (hann mainLobe ≈ documented value ±, sideLobe ≈ −31.5 dB ±1 within tolerance); UI smoke (tooltip toggle, console clean); i18n parity.

- [ ] Commit `feat(F08): window comparison panel with measured lobes`

### Task 3: Generator panel (F12 core)

**Files:** Create `apps/web/src/features/generator/{generatorView.tsx,generatorState.ts,genPreviewCanvas.ts}`; worker op `generateSynth(params)` over the dsp generators (`generateSine`, `generateNoise*`, chirp, impulse, step, two-tone, AM/FM?) — AGENTS F12 P1 sweep: sine/square/saw/tri/impulse/step/white|pink noise/chirp linear|log/two-tone (AM/FM deferred to Wave 4+).

**Interfaces:**
- Param block `{waveform, frequencyHz, amplitude, durationSeconds, sampleRateHz: 48000, noiseColor, chirp {fromHz, toHz, log: boolean}, tone2Hz}` — validated (units in every label, Latin digits), 300 s cap enforced client-side (honest UX), dsp-guaranteed params delegated.
- Preview: small waveform canvas via the worker op (bucketed) — no main-thread synth.
- "Load as generator source" → `loadSource(..., sourceKind: "generated")` → tools work; the generator remembers last params per session (localStorage `avalab.generator.last`, no audio persisted ever).

**Tests:** op-level synth sanity (frequency = requested via FFT peak; duration = exact samples; noise RMS deterministic per seed); param↔URL codec; a11y labels units; Playwright: generate → load → waveform page shows real signal, console clean fa/en.

- [ ] Commit `feat(F12): signal generator view over dsp generators`

### Task 4: Wave 2 closing — cross-tool polish + wave docs

**Files:** Modify sidebar cards (tool descriptions from i18n), `docs/PROGRESS.md` Wave 2 section (built/verified/deferred), `docs/plans/README.md` wave-2 → done, `docs/THIRD_PARTY.md` (uplot row with verified version + MIT license), Playwright: one "wave smoke" spec exercising load demo → waveform → spectrogram → fftview → generator happy-path with zero console errors and asserting the §9 perf gates pass once more as one run (idempotent, offline-safe).

**Interfaces:** none beyond content edits + the closing spec.

**Tests:** full `pnpm check`, `pnpm e2e`, plus the wave smoke; PROGRESS carries measured numbers from real runs (report files under `.superpowers/sdd/` are git-ignored scratch — only PROGRESS carries the retention).

- [ ] Commit `docs(wave-2): close wave 2 with measured gates`
