# Wave 6 baseline feature audit

Date: 2026-11-05
Scope: AGENTS.md §4, F01–F18, measured against the `feat/wave-5` baseline plus Plan 00 fixes.
Status meanings:

- `implemented` — the shipped behavior satisfies the bullet; evidence exists.
- `partial` — the core exists, but a named part of the bullet is absent.
- `missing` — the bullet has no shipped implementation.
- `out of scope` — deliberately excluded or deferred by an owner decision or priority.

Plan 04 must not add a feature that is absent from this table. Every `partial`,
`missing`, or `out of scope` row maps to a later Wave 6 plan or an explicit
owner decision in the checklist at the end.

| ID | AGENTS.md bullet | Status | Evidence files | Evidence tests | Missing work / owner |
|---|---|---|---|---|---|
| F01 | Upload any ffmpeg-decodable format, enforce limits, normalize to canonical PCM WAV | implemented | `apps/api/src/avalab_api/routes/ingest.py`, `ffmpeg.py`, `upload_limit.py`, `apps/web/src/features/input/ingest.ts`, `upload.tsx` | `apps/api/tests/test_ingest.py`, `apps/web/src/features/input/ingest.test.ts`, `apps/web/e2e/upload.spec.ts` | None |
| F01 | Microphone recording, signal generator, bundled demo clips | implemented | `apps/web/src/features/input/record.tsx`, `apps/web/src/features/generator/generatorView.tsx`, `apps/web/src/features/input/demo.tsx`, `apps/web/public/demo/` | `apps/web/src/features/generator/generatorState.test.ts`, `apps/web/src/features/input/offline.test.ts`, `apps/web/e2e/demo.spec.ts` | None; AM/FM generator UI is tracked under F12 |
| F01 | Mono downmix for analysis, stereo preserved for playback | partial | `apps/web/src/features/input/ingest.ts` (`monoDownmix`), backend canonical WAV preserves channels | `ingest.test.ts`, `apps/api/tests/test_ingest.py` | Frontend always downmixes before `loadSource`; no stereo playback lane. Owner decision: keep mono-only playback or schedule it outside Plan 04 |
| F02 | Waveform zoom, pan, playhead, selection, overview plus detail | implemented | `apps/web/src/features/waveform/waveformView.tsx`, `apps/web/src/features/waveform/canvasWaveform.tsx`, `apps/web/src/features/waveform/interactions.ts`, `apps/web/src/features/waveform/paintWaveform.ts` | `apps/web/src/features/waveform/interactions.test.ts`, `apps/web/src/features/waveform/paintWaveform.test.ts`, `apps/web/e2e/waveform.spec.ts` | None |
| F02 | Spectrogram window, hop, FFT size, dB range, axes, colormaps | implemented | `apps/web/src/features/spectrogram/spectrogramView.tsx`, `apps/web/src/features/spectrogram/paintSpectrogram.ts`, `apps/web/src/features/spectrogram/colormapLegend.tsx` | `apps/web/e2e/spectrogram.spec.ts`; spectrogram op tests in `apps/web/src/session/ops.test.ts` | None |
| F02 | Before/after comparison for any processing step | partial | `apps/web/src/features/waveform/compareSlot.tsx`; per-tool result spectrograms (for example `apps/web/src/features/speed/speedView.tsx`) | `apps/web/src/features/waveform/interactions.test.ts`, `apps/web/src/features/speed/speedState.test.ts` | No general processed-spectrogram overlay. Owner decision: accept per-tool result views or schedule an F02 comparison view |
| F02 | Live playhead sync between waveform and spectrogram | implemented | `apps/web/src/features/player/playhead.ts`, `apps/web/src/features/player/usePlayer.ts`, waveform and spectrogram canvases | `player/playhead.test.ts`, `transport.test.ts`, e2e playback smoke | None |
| F03 | Resample with anti-alias filter toggle, audible aliasing, predicted alias demo | implemented | `packages/dsp/src/resample/`, `packages/dsp/src/signals/aliasing.ts`, `apps/web/src/features/sampling/samplingView.tsx` | `packages/dsp/test/resample/`, `packages/dsp/test/signals/aliasing.test.ts`, `samplingState.test.ts`, `ops.test.ts` | None |
| F03 | Bit-depth reduction, uniform quantization, optional dither, error, measured vs theoretical SNR | implemented | `packages/dsp/src/metrics/quantize.ts`, `apps/web/src/features/sampling/samplingView.tsx` | `packages/dsp/test/metrics/quantize.test.ts`, `samplingState.test.ts`, `ops.test.ts` | None |
| F03 | Play and display the processed residual/difference | implemented | `samplingView.tsx` residual playback and quantized/error lanes, `apps/web/src/session/ops.ts` sampling op | `sampling`/`ops` tests | None |
| F04 | Hand-written RLE, canonical Huffman, delta+Huffman, μ-law/A-law, MDCT toy codec with internals | implemented | `packages/dsp/src/codecs/`, `apps/web/src/features/codecLab/codecLabView.tsx` | `packages/dsp/test/codecs/`, `codecLabState.test.ts`, `ops.test.ts` | Known tonal-collapse limitation of the MDCT rate model, documented in ALGORITHMS; not a missing feature |
| F04 | Real FLAC, MP3, AAC, Opus, Vorbis and WAV via ffmpeg with bitrate/quality controls | implemented | `apps/api/src/avalab_api/routes/codec.py`, `apps/api/src/avalab_api/codecs.py`, `apps/web/src/features/codecLab/backendCodecs.ts` | `apps/api/tests/test_codec.py`, `backendCodecs.test.ts`, `apps/web/e2e/codec-lab.spec.ts` | None |
| F04 | Side-by-side comparison table, charts, bits/bitrate/entropy internals | implemented | `apps/web/src/features/codecLab/codecLabView.tsx`, `comparison.ts`, `rateDistortionChart.tsx` | `comparison.test.ts`, `comparisonRunner.test.ts`, `rateDistortionChart.test.ts` | None |
| F04 | Lossless round-trip must be bit-exact and visibly verified | implemented | RLE, Huffman, delta+Huffman codecs; codec-lab `bitExact` row | `packages/dsp/test/codecs/`, `ops.test.ts` | None |
| F05 | MSE, SNR, segmental SNR, PSNR, compression ratio, bitrate, entropy | implemented | `packages/dsp/src/metrics/`, `apps/web/src/features/metrics/`, codec-lab stats | `packages/dsp/test/metrics/`, `metrics.test.ts`, `ops.test.ts` | None |
| F05 | Documented PSNR peak and codec-delay alignment before comparison | implemented | `apps/web/src/features/metrics/metrics.ts`, `apps/api/src/avalab_api/alignment.py`, `routes/codec.py` | `metrics.test.ts`, `apps/api/tests/test_alignment.py`, `test_codec.py` | None |
| F05 | Rate–distortion plot versus bitrate | implemented | `apps/web/src/features/codecLab/rateDistortionChart.tsx`, `comparisonRunner.ts` | `rateDistortionChart.test.ts`, `comparisonRunner.test.ts` | None |
| F05 | Optional perceptual metric computed on the backend | out of scope | — | — | D-005: deferred; fallback candidate `pystoi` only if later requested |
| F06 | Speed presets and custom speed, reverse, seek, play-direction controls | implemented | `apps/web/src/features/speed/speedView.tsx`, `player/player.tsx`, `transport.ts` | `speedState.test.ts`, `transport.test.ts` | None |
| F06 | Resampling speed mode and pitch-preserving time-stretch mode | implemented | `packages/dsp/src/timestretch/phaseVocoder.ts`, `session/ops.ts`, `speedView.tsx` | `packages/dsp/test/timestretch/`, `ops.test.ts`, `speedState.test.ts` | None |
| F06 | Show the result spectrogram so the mode difference is visible | implemented | `apps/web/src/features/speed/speedView.tsx` result spectrogram | `speedState.test.ts`, e2e smoke | None |
| F07 | Duration, sample count, support, energy/power, energy vs power classification | implemented | `packages/dsp/src/signals/extent.ts`, `packages/dsp/src/utils/energy.ts`, `apps/web/src/features/extent/extentView.tsx` | `packages/dsp/test/signals/extent.test.ts`, `packages/dsp/test/energy.test.ts`, `extentState.test.ts` | None |
| F07 | Truncate, zero-pad, time shift, time scale, time reversal | implemented | `packages/dsp/src/signals/extent.ts`, `extentView.tsx` | `extent.test.ts`, `ops.test.ts`, `extentState.test.ts` | None |
| F07 | Frequency resolution, leakage, zero-padding interpolation, uncertainty trade-off | implemented | `apps/web/src/features/extent/extentView.tsx`, `fftview` spectrum, theory copy | `extentState.test.ts`, `ops.test.ts` | None |
| F07 | Finite duration versus periodic extension comparison | implemented | `extentView.tsx` periodic operation, `packages/dsp/src/signals/extent.ts` | `extentState.test.ts`, `extent.test.ts` | None |
| F08 | DFT/FFT magnitude and phase plus STFT view, magnitude masking | implemented | `packages/dsp/src/fourier/`, `apps/web/src/features/fftview/fftView.tsx` | `packages/dsp/test/fourier/`, `fftState.test.ts`, `ops.test.ts` | None |
| F08 | Window comparison with main-lobe and side-lobe teaching | implemented | `apps/web/src/features/fftview/fftView.tsx`, `packages/dsp/src/fourier/windows.ts` | `windows.test.ts`, `fftState.test.ts` | None |
| F08 | Our FFT versus library FFT benchmark, and Cooley–Tukey butterfly step-through | missing | — | — | Plan 04 Tasks 1–2 |
| F09 | Show Re, Im, magnitude and phase | implemented | `apps/web/src/features/spectrumEdit/spectrumEditView.tsx`, `session/ops.ts` | `spectrumEditState.test.ts`, `ops.test.ts` | None |
| F09 | Zero, scale, set or draw values on bins/bands, then IFFT playback | partial | `spectrumEditView.tsx` band entry for `re/im/mag/phase`, numeric mode `zero/scale/set`, IFFT playback | `spectrumEditState.test.ts`, `ops.test.ts` | No freehand/brush or curve editor. Plan 04 Task 3 |
| F09 | Hermitian-symmetry toggle with complex-result teaching | implemented | `spectrumEditView.tsx`, `packages/dsp/src/fourier/spectrumEdit.ts` | `spectrumEditState.test.ts`, `ops.test.ts` | None |
| F09 | Presets: zero Im/Re/phase, linear/random phase, magnitude/phase-only | implemented | `spectrumEditState.ts`, `spectrumEditView.tsx` | `spectrumEditState.test.ts` | None |
| F09 | Frequency-mask drawing with visible Gibbs/ringing | partial | Brick-wall band edits in `spectrumEditView.tsx` | `spectrumEditState.test.ts`, `ops.test.ts` | Numeric band masks exist; pointer drawing is missing. Plan 04 Task 3 |
| F10 | Reverse and reverb kept distinct, with correct terminology | implemented | `apps/web/src/features/reverb/reverbView.tsx`, `reverbState.ts` | `reverbState.test.ts`, e2e reverb smoke | None |
| F10 | Reverb convolution with built-in/uploaded IRs, wet/dry, pre-delay | implemented | `packages/dsp/src/systems/`, `session/ops.ts`, `reverbView.tsx` | `packages/dsp/test/systems/`, `ops.test.ts`, `reverbState.test.ts` | None |
| F10 | Show IR, its spectrum, and flip-and-slide convolution steps | implemented | `reverbView.tsx`, `convolutionSteps` op | `ops.test.ts`, `reverbState.test.ts` | None |
| F10 | FFT fast convolution default with direct-convolution comparison and timing | implemented | `packages/dsp/src/systems/convolution.ts`, `reverbView.tsx` timing card | `convolutionFft.test.ts`, `ops.test.ts`, `reverbState.test.ts` | None |
| F11 | Low/high/band-pass, band-stop/notch; FIR and IIR designs | implemented | `packages/dsp/src/filters/`, `apps/web/src/features/filters/filterLabView.tsx` | `packages/dsp/test/filters/`, `filterState.test.ts`, `filterLabView.test.tsx` | None |
| F11 | Magnitude, phase, group delay, impulse/step response, pole-zero plot, stability | implemented | `apps/web/src/features/filters/filterPlots.tsx`, `apps/web/src/features/filters/poleZeroPlot.tsx`, `packages/dsp/src/filters/analysis.ts` | `analysis.test.ts`, `apps/web/src/features/filters/filterLabView.test.tsx` | None |
| F11 | Apply to loaded audio with live preview and processed spectrogram | implemented | `filterLabView.tsx`, `filterApply` op | `filterLabView.test.tsx`, `filterState.test.ts`, `ops.test.ts` | None |
| F12 | Sine, square, sawtooth, triangle, impulse, step, white/pink noise, chirp, two-tone, AM/FM | partial | `packages/dsp/src/signals/generators.ts`, `apps/web/src/features/generator/generatorState.ts`, `generatorView.tsx` | `generators.test.ts`, `generatorState.test.ts` | AM/FM DSP exists but the generator UI has no AM/FM controls. Plan 04 Task 4 |
| F12 | Fourier-series reconstruction with harmonic slider and Gibbs demo | missing | DSP helper exists: `packages/dsp/src/signals/fourierSeries.ts` | `fourierSeries.test.ts` | No UI. Plan 04 Task 4 |
| F13 | Frequency masking over Bark bands linked to MDCT bit allocation | missing | — | — | Plan 01 |
| F13 | Absolute threshold of hearing overlay | missing | — | — | Plan 01 |
| F14 | Source separation, denoising, super-resolution, neural codec | implemented | `apps/api/src/avalab_api/ml/`, `apps/api/src/avalab_api/routes/ml.py`, `apps/web/src/features/ai/` | `apps/api/tests/test_ml_*`, AI tab tests, `docs/MODELS.md` smoke | None |
| F14 | Whisper ASR with WER versus compression level | implemented | `apps/api/src/avalab_api/ml/asr.py`, `apps/web/src/features/ai/asrTab.tsx`, `wer.ts` | `test_ml_asr.py`, `asrTab.test.tsx`, `wer.test.ts` | None |
| F14 | Pitch/F0 and beat tracking | missing | — | — | Plan 04 Task 5 |
| F14 | Audio classification | out of scope | — | — | AGENTS P3 lowest priority; owner decision required to add |
| F15 | Pipeline builder with chained blocks, per-stage results, save/load JSON | missing | — | — | Plan 02 |
| F16 | Theory panel on every tool | partial | `apps/web/src/features/theory/TheoryPanel.tsx`; panels exist for sampling, metrics, codec-lab, filters, AI | `TheoryPanel.test.tsx`, `filterTheory.test.ts`, `aiTheory.test.ts` | Missing panels for waveform, spectrogram, fftview, spectrum-edit, speed, reverb, generator, extent, pipeline, psychoacoustics. Plan 04 Task 6 |
| F16 | Guided experiments, 5–8 per P0/P1 tool with expected observations | partial | `apps/web/src/features/education/experiments.ts`, `experimentsView.tsx` | `experiments.test.ts`, `experimentsView.test.tsx` | Only a small initial set exists. Plan 04 Task 7 |
| F16 | Share by URL including demo clip, never user audio | implemented | `apps/web/src/lib/url-state.ts`, per-tool state codecs, `apps/web/src/features/input/demoDeepLink.ts` | `url-state.test.ts`, per-tool state tests, `demoDeepLink.test.ts` | None |
| F16 | Export processed WAV, chart PNG, PDF/HTML lab report | partial | `apps/web/src/lib/download.ts`; WAV in filters/AI, chart PNG in codec lab | `download.test.ts`, `filterLabView.test.tsx`, `rateDistortionChart.test.ts` | No general processed-WAV/PNG export and no student lab report. Owner decision: accept shipped exports or schedule outside Plan 04 |
| F17 | Persian and English, Persian default, full RTL | implemented | `apps/web/src/i18n/`, `apps/web/src/app/layout.tsx`, logical Tailwind classes | `routes.test.tsx`, `e2e` fa/en flows | None |
| F17 | No hard-coded visible strings; key parity enforced in CI | implemented | `scripts/i18n-check.mjs`, `package.json` check chain | `scripts/i18n-check.test.mjs`, `pnpm i18n:check` | None |
| F17 | Natural academic Persian, machine drafts flagged for owner review | partial | `apps/web/src/i18n/fa.json`, PROGRESS review list | `i18n:check` parity only | Human Persian review still pending. Plan 07 final review |
| F17 | Logical CSS properties, LTR technical readouts and units | implemented | layout, tool views, `dir="ltr"` readouts | `routes.test.tsx`, e2e both directions | None |
| F18 | Instant A/B listening with optional loudness matching | partial | `apps/web/src/features/player/player.tsx`, `apps/web/src/features/player/transport.ts`, processed lane | `transport.test.ts`, e2e playback | Lane swap is position-preserving; loudness matching is missing. Plan 03 Tasks 1–4 |
| F18 | Keyboard shortcuts, persistent last-used settings, light/dark theme, responsive layout | partial | responsive logical layout exists; generator/filter persistence exists; language persistence exists | `generatorState.test.ts`, `filterState.test.ts` | Theme, global shortcuts, help dialog and broad settings persistence are missing. Plan 03 Tasks 5–7 |

## No-silent-drops checklist

| Row | Disposition |
|---|---|
| F01 stereo playback | Owner decision: explicit mono-only accept, or schedule outside Plan 04 |
| F02 general before/after comparison | Owner decision: accept per-tool result views, or schedule an F02 comparison view |
| F05 perceptual metric | Out of scope per D-005 |
| F08 benchmark and butterfly view | Plan 04 Tasks 1–2 |
| F09 curve drawing / freehand mask | Plan 04 Task 3 |
| F12 AM/FM UI | Plan 04 Task 4 |
| F12 Fourier-series UI | Plan 04 Task 4 |
| F13 psychoacoustics | Plan 01 |
| F14 pitch and beat tracking | Plan 04 Task 5 |
| F14 audio classification | Out of scope per AGENTS P3; owner decision required |
| F15 pipeline builder | Plan 02 |
| F16 theory coverage | Plan 04 Task 6 |
| F16 experiment coverage | Plan 04 Task 7 |
| F16 student lab report | Owner decision: accept shipped exports or schedule outside Plan 04 |
| F17 Persian review | Plan 07 final review |
| F18 loudness matching | Plan 03 Tasks 1–4 |
| F18 theme, shortcuts, broad persistence | Plan 03 Tasks 5–7 |

## Audit evidence command

```bash
rg -n "F0[1-9]|F1[0-8]" docs/plans/wave-6/audit.md
```
