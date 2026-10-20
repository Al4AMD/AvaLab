# Wave 1 · Plan 02 — Signal generators, Fourier series, extent, metrics, quantization, resampling, companding

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** The Signals-and-Systems teaching core: deterministic generators, Fourier-series/Gibbs demo, signal-extent operations, quality metrics, uniform quantization with TPDF dither, rational resampling with/without anti-aliasing, μ-law/A-law companding — all golden-verified and property-tested.

**Architecture:** Pure TS in `packages/dsp/src/signals/` and `packages/dsp/src/metrics/`. Everything Float64 with explicit `sampleRateHz`/`durationSeconds` in every signature. Noise uses a pinned seeded PRNG (mulberry32) — deterministic across runs; cross-language goldens only for closed-form signals (documented in ALGORITHMS.md).

**Tech Stack:** TypeScript strict; vitest; NumPy/SciPy (and stdlib `audioop` for G.711 reference on Python 3.12) golden.

**Spec:** `AGENTS.md` §11 + F03/F07/F12 + `docs/plans/wave-0/foundation.md` Global Constraints + `docs/plans/wave-1/01-fourier-transforms.md` Global Constraints (kernel/scaling convention, Float64, edge cases).

## Review Focus

1. **Dither honesty** — TPDF dither at Δ-step scale: test must show decorrelation (cross-corr with signal ≈ 0) and that SNR-vs-theoretical still holds within ±0.5 dB at b=8 for a full-scale sine; a dither test that only checks "noise was added" fails the review. Clipping is honest, not a defect: TPDF excursions of ±Δ push full-scale samples past ±1 and the post-round clip correlates the error. Pin `|ρ| < 0.05` at amplitude `1 − Δ` (the full-scale-with-dither-headroom operating point, no clipping) and at 0.6, and `|ρ| > 0.1` at amplitude 1 as the known headroom requirement: back off to ≤ `1 − Δ` or accept clip correlation (R11).
2. **Aliasing exactness (no-filter resample)** — a sine at 0.8×Nyquist decimated 2× without filter must land at the exact folded frequency `|f − fs|`, not approximately: this is F03's whole teaching point.
3. **Generator closed-form exactness at boundaries** — sine at exactly phase 0 first sample = 0; square at half-period transitions defined by sign(sin) (value at zeros pinned to +1, documented); sawtooth range pinned [−1,1). Tests assert first/last samples.
4. **Segmental SNR silence handling** — frames of pure silence must not divide by zero: pinned behavior = frame contributes nothing (skipped), result over active frames only, silence in ALL frames → `Infinity`; test asserts.

---
### Task 1: Closed-form signal generators

**Files:** Create `packages/dsp/src/signals/generators.ts`, golden `algorithms/generators.py` → `golden/generators.json`, test `packages/dsp/test/signals/generators.test.ts`; ALGORITHMS.md entry (formula per waveform).

**Interfaces (Produces — UI F12 and tests depend on these exact names):**
```ts
interface SignalSpec { durationSeconds: number; sampleRateHz: number }
generateSine(spec: SignalSpec & { frequencyHz: number; amplitude: number; phaseRad?: number }): Float64Array
generateSquare(spec & { frequencyHz, amplitude, dutyCycle?: number }): Float64Array   // sign(sin), zeros → +1, duty applied by phase threshold, documented
generateSawtooth(spec & { frequencyHz, amplitude }): Float64Array   // rising, range [−a, a)
generateTriangle(spec & { frequencyHz, amplitude }): Float64Array
generateImpulse(spec & { impulseSampleIndex: number; amplitude }): Float64Array
generateStep(spec & { stepSampleIndex: number; amplitudeBefore: number; amplitudeAfter: number }): Float64Array
generateChirp(spec & { startFrequencyHz, endFrequencyHz, sweep: "linear" | "logarithmic" }): Float64Array   // phase = 2π∫f(t)dt closed form both sweeps
generateTwoTone(spec & { frequenciesHz: [number, number]; amplitude }): Float64Array
generateAm(spec & { carrierHz, modulationHz, modulationIndex }): Float64Array
generateFm(spec & { carrierHz, modulationHz, frequencyDeviationHz }): Float64Array
```
Sample count = `Math.round(durationSeconds * sampleRateHz)`; time base `n / sampleRateHz`. Guards: `sampleRateHz ≤ 0`, `durationSeconds < 0`, `amplitude` NaN → `RangeError`/`TypeError`; duration 0 → empty array.

**Golden cases (NumPy formulas):** each generator, duration T=0.01 s, fs=1000 (N=10, readable values); chirp both sweeps; square duty 0.25; impulse index 3; step index 4. Tolerance rtol 1e-9, atol 1e-12.

**Tests:** goldens; boundary samples asserted explicitly (sine[0]=0; square at zeros = +1; sawtooth in [−a, a)); chirp instantaneous frequency endpoints via 2-sample phase difference ≈ 2πf/fs; full-cycle sine energy = N/2·a² (property); guards throw.

- [ ] Commit `feat(F12): closed-form signal generators with golden tests`

### Task 2: Noise generators (seeded, deterministic)

**Files:** Create `packages/dsp/src/signals/noise.ts`, test `packages/dsp/test/signals/noise.test.ts`; ALGORITHMS.md entry (mulberry32 PRNG + Voss–McCartney pink noise, reference McCartney 1999; documented as NOT cross-language golden — deterministic within TS by pinned seed).

**Interfaces:**
- `mulberry32(seed: number): () => number` — [0,1); exported for reuse + testing
- `generateWhiteNoise(spec: SignalSpec & { seed: number; amplitude: number }): Float64Array` — values a·(2u−1)
- `generatePinkNoise(spec: SignalSpec & { seed: number; amplitude: number }): Float64Array` — Voss–McCartney with pinned octave count 16, normalized to peak ≤ amplitude
- `generateNoise` means noise is NOT reproducible across language/version — header documents this

**Tests:** same seed → identical arrays (byte-compare); different seeds differ; white: mean |μ| < 0.02, std within 3% of a/√3 for N=48000 (statistical, seeded so deterministic); pink: octave-band FFT energy ratio between consecutive octaves ≈ 3 dB/oct ±1.5 dB (uses `fft` from plan 01); amplitude bounds hold.

- [ ] Commit `feat(F12): seeded white and pink noise generators`

### Task 3: Fourier-series reconstruction + Gibbs

**Files:** Create `packages/dsp/src/signals/fourierSeries.ts`, golden `algorithms/fourier_series.py` → `golden/fourier_series.json`, test `packages/dsp/test/signals/fourierSeries.test.ts`; ALGORITHMS.md entry (series coefficients per waveform, reference Oppenheim & Willsky).

**Interfaces:**
- `fourierSeriesPartialSum(spec: SignalSpec & { kind: "square" | "sawtooth" | "triangle"; frequencyHz: number; harmonics: number; amplitude: number }): Float64Array` — harmonics ≥ 1 integer; k-th term with the standard coefficients (square: odd 4a/(πk); sawtooth: 2a/(πk) alternating; triangle: odd 8a/(π²k²) alternating)
- `measureGibbsOvershoot(samples: Float64Array, amplitude: number): number` — max(|x|)/a − 1 (≈0.179 at h=51; 0.0895 is this overshoot relative to the 2a jump)

**Golden cases (NumPy direct series):** square h=1,3,5,51 (three cases), sawtooth h=10, triangle h=9; fs=1000 T=0.02. Tolerance rtol 1e-9.

**Tests:** goldens; Gibbs: square h=51 gives max(|x|)/a − 1 ≈ 0.179 ± 0.002 (0.0895 is the same overshoot relative to the peak-to-peak jump 2a); MSE vs ideal square decreases monotonically as harmonics 1→3→5→51; triangle converges faster than square (MSE ratio assertion) — the pedagogical property.

- [ ] Commit `feat(F12): fourier series reconstruction and gibbs measurement`

### Task 4: Signal-extent operations

**Files:** Create `packages/dsp/src/signals/extent.ts`, golden `algorithms/extent.py` → `golden/extent.json`, test `packages/dsp/test/signals/extent.test.ts`; ALGORITHMS.md entry.

**Interfaces:**
- `timeShift(x, shiftSamples: number): Float64Array` — integer shift, zero-fill (same length)
- `timeScale(x, factor: number): Float64Array` — plain sample-domain resampling by linear interpolation; `outputLength = round(N/factor)`; intentionally filter-free (teaching demo of x(at)); documented
- `reverse(x): Float64Array`
- `truncate(x, startSampleIndex, lengthSamples): Float64Array` — out-of-range start → `RangeError`; clamps end with zero-fill? NO — clamps to available, documented
- `zeroPad(x, padStartSamples, padEndSamples): Float64Array`
- `support(x, { threshold: number }): { startSampleIndex: number; endSampleIndex: number }` — first/last |x| > threshold (inclusive); all-below → length-0 support `{start: N, end: N−1}` documented
- `classifySignalType(x): "energy" | "power"` — finite nonzero support → energy, else power, documented rule

**Golden cases (NumPy reference implementations of the same pinned definitions):** shift ±3 on N=10 ramp; timeScale 0.5 and 2 on N=10 ramp; reverse; truncate; zeroPad. Tolerance rtol 1e-12 (exact arithmetic expected).

**Tests:** goldens; timeShift |FFT| invariant (plan 01 fft); timeScale halves/duplicates duration; reverse twice = identity; zeroPad adds exact count; support on silence; energy/power classification of impulse vs constant.

- [ ] Commit `feat(F07): signal extent operations with golden tests`

### Task 5: Quality metrics

**Files:** Create `packages/dsp/src/metrics/basic.ts`, `packages/dsp/src/metrics/entropy.ts`, golden `algorithms/metrics.py` → `golden/metrics.json`, test `packages/dsp/test/metrics/basic.test.ts`, `packages/dsp/test/metrics/entropy.test.ts`; ALGORITHMS.md entries (PSNR peak convention pinned: **peak = 1.0 for float audio; UI must show this definition**).

**Interfaces:**
- `mse(reference, test): number`; `snrDb(reference, test): number` — 10·log10(Σref²/Σerr²); identical → `Infinity`; both zero → NaN documented
- `segmentalSnrDb(reference, test, { frameLengthSamples: number }): number` — per-frame SNR, frames entirely silent in ref (energy 0) skipped; none active → `Infinity`
- `psnrDb(reference, test, { peak: number }): number` — peak is REQUIRED (no default — forces the caller to state the convention); 10·log10(peak²/mse)
- `compressionRatio(originalBytes: number, compressedBytes: number): number`; `bitrateKbps(bytes: number, durationSeconds: number): number`
- `entropyBitsPerSymbol(symbols: Uint8Array | Int32Array): number` — Shannon H = −Σp log2 p; empty → 0
- Gaussian noise added at known SNR → recovered SNR within ±0.1 dB (property, seeded)

**Golden cases (NumPy):** mse/snr/psnr on sine vs quantized sine; segmental with one silent frame; entropy on skewed histogram. Tolerance rtol 1e-9.

- [ ] Commit `feat(F05): quality metrics with pinned psnr peak convention`

### Task 6: Uniform quantization + TPDF dither

**Files:** Create `packages/dsp/src/metrics/quantize.ts`, golden `algorithms/quantize.py` → `golden/quantize.json`, test `packages/dsp/test/metrics/quantize.test.ts`; ALGORITHMS.md entry (mid-tread, formula, dither definition, reference: Zölzer).

**Interfaces:**
- `quantizeUniform(x: Float64Array, { bits: number }): Float64Array` — pinned: mid-tread, `levels = 2**bits`, step `Δ = 2 / (2**bits − 1)`, value = Δ·round(x/Δ), clip to [−1, 1] after; bits 1..24 → else `RangeError`
- `quantizeWithTpdfDither(x, { bits, seed }): Float64Array` — additive TPDF noise of width Δ (±Δ each uniform) then quantify with same quantizer (the sum is applied before rounding — formula documented)
- `quantizationError(original, quantized): Float64Array` — original − quantized (observation convention, UI labels it)

**Golden cases (NumPy same pinned definition):** ramp quantize b=3 exact values; sine b=8; clipping case |x|>1. Tolerance rtol 1e-12.

**Tests:** goldens; measured SNR of full-scale sine ≈ 6.02·b + 1.76 dB within ±0.5 dB for b∈{4,8,12}; SNR monotone in b; dither: cross-correlation coefficient of error with signal |ρ| < 0.05 for b=4 at amplitude `1 − Δ` and at 0.6 (undithered same cases |ρ| > 0.3 — asserts the pedagogical contrast); amplitude 1 gives |ρ| > 0.1 (clipping correlation, known headroom requirement: back off to ≤ `1 − Δ` or accept clip correlation, R11); dither determinism per seed and distinct dither for distinct seed pairs; clipping bounded to [−1,1].

- [ ] Commit `feat(F03): uniform quantization with tpdf dither and snr verification`

### Task 7: Resampling (with anti-alias filter + aliasing demo mode)

**Files:** Create `packages/dsp/src/resample/resample.ts`, `packages/dsp/src/resample/windowedSinc.ts`, golden `algorithms/resample.py` → `golden/resample.json`, test `packages/dsp/test/resample/resample.test.ts`; ALGORITHMS.md entry (windowed-sinc low-pass design + polyphase rational L/M resampler, reference: Smith, *Digital Audio Resampling*).

**Interfaces:**
- `designLowpassSinc({ cutoffNormalized: number; halfLengthSamples: number; beta: number }): Float64Array` — windowed sinc, cutoff as fraction of Nyquist (0..1), uses `kaiser` (symmetric) from plan 01
- `resampleRational(x, { inputRateHz, outputRateHz, filter: "kaiserSinc" | "none" }): Float64Array` — L/M from gcd of rates; filter "none" = plain interpolation/decimation by nearest sample index (pin: output[n] = x[round(n·M/L)]) — this is the aliasing demo path, documented loudly
- Kaiser params pinned: beta 8.6, halfLength 16 (documented; golden uses identical params in SciPy equivalent)
- Edge: same rates → copy; `outputRateHz ≤ 0` → RangeError; output length = `round(N · outRate/inRate)`

**Golden cases (scipy.signal.resample_poly with kaiser(8.6, 16), after normalizing taps the same way — golden script documents its construction):** 48000→24000 sine 5 kHz; 44100→48000 sine 1 kHz; 48000→8000 sine 1 kHz. Tolerance rtol 1e-7 (filter design FP differences are larger than 1e-9 — documented deviation from the default tolerance).

**Tests:** goldens; no-filter aliasing exactness: sine 6 kHz at fs 16 kHz, decimate to 8 kHz no-filter → dominant FFT peak at |6000−16000|? compute: target Nyquist 4 kHz; alias = |6000 − 8000| = 2000 Hz — assert peak at 2000 ± 10 Hz (uses fft); with filter: alias peak ≤ −40 dB of 2 kHz peak? original 6 kHz is above target Nyquist — with filter it is attenuated: assert output energy < 1% of unfiltered case; same-rate passthrough exact; duration preserved ±1 sample; edge rates.

- [ ] Commit `feat(F03): rational resampling with anti-alias filter and aliasing mode`

### Task 8: μ-law / A-law companding

**Files:** Create `packages/dsp/src/metrics/companding.ts`, golden `algorithms/companding.py` → `golden/companding.json`, test `packages/dsp/test/metrics/companding.test.ts`; ALGORITHMS.md entry (ITU-T G.711 formulas, full ±1.0 domain, reference implementation via Python stdlib `audioop` — pinned Python 3.12).

**Interfaces:**
- `mulawEncode(x: Float64Array, { bits: 8 }): Uint8Array` — input in [−1,1], G.711 μ=255
- `mulawDecode(bytes: Uint8Array): Float64Array` — to [−1,1]
- `alawEncode(x, { bits: 8 }): Uint8Array`; `alawDecode(bytes): Float64Array` — A=87.6, G.711 A-law pin (even-bit inversion convention documented)

**Golden cases (`audioop.lin2ulaw`/`ulaw2lin` on 16-bit PCM — independent stdlib implementation):** ramp 16-bit; sine b=8-equivalent; both codecs, encode + decode. Tolerance: exact byte equality for encode; rtol 1e-6 for decode (16-bit scale conversion). Golden script silences the audioop DeprecationWarning explicitly.

**Tests:** goldens; roundtrip error bounded by half a code step (property, ≤ 2^-8 of full scale for large values, larger relative resolution at small amplitudes documented); μ-law small-signal: SNR of a −40 dBFS sine under μ-law > SNR under uniform 8-bit by ≥ 8 dB (pedagogical property); decode(encode(x)) length preserved; input |x|>1 clipped before encode (documented, tested).

- [ ] Commit `feat(F04): mu-law and a-law companding with g.711 golden tests`
