# Wave 1 · Plan 03 — Convolution and filters

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Linear systems core: direct and FFT convolution (reverb/filter backbone), FIR window-method design, IIR design (Butterworth, Chebyshev I, RBJ biquads), frequency/phase/group-delay response and pole-zero analysis with stability.

**Architecture:** Pure TS in `packages/dsp/src/systems/` and `packages/dsp/src/filters/`. Convolution consumes the Fourier core (plan 01): `fft`/`ifft` from `src/fourier/transform.ts`. Filter design consumes `windowSymmetric`/`kaiser` from `src/fourier/windows.ts`.

**Tech Stack:** TypeScript strict; vitest; SciPy `signal` golden (firwin/butter/cheby1/freqz/group_delay), NumPy roots.

**Spec:** `AGENTS.md` §11 + F10/F11 + wave-0 Global Constraints + plan 01 Global Constraints (kernel/scaling, Float64, edge cases).

## Review Focus

1. **Fast-conv block-boundary correctness** — overlap-add must be golden/property-tested with signal length NOT a multiple of block size and with IR longer than block (the classic off-by-one-tail bug); equivalence vs direct must hold at the array tail, not only the middle.
2. **IIR stability honesty** — `designButterworth` at high order in b/a form is numerically fragile: pinned max order 8, and the pole-zero/stability test must verify poles strictly inside the unit circle for every golden design; an unstable design must be reported (`isStable=false`), never silently returned as fine.
3. **Linear-phase check for FIR** — even/odd tap counts both allowed; symmetry asserted (h[n]=h[N−1−n]) since F11 teaches linear phase; a broken window application would break symmetry.
4. **Group-delay definition** — pinned as −d∠H/dω via central finite difference on the unwrapped phase, documented; unwrap must be the plan's own unwrap (implemented here, golden vs numpy.unwrap).

---
### Task 1: Direct linear convolution

**Files:** Create `packages/dsp/src/systems/convolution.ts`, golden `algorithms/convolution_direct.py` → `golden/convolution_direct.json`, test `packages/dsp/test/systems/convolution.test.ts`; ALGORITHMS.md entry.

**Interfaces (Produces — plan 04 and Wave 3 reverb consume):**
- `convolveDirect(x: Float64Array, h: Float64Array): Float64Array` — length N+M−1; guard: either empty → `RangeError`; NaN/Inf → `TypeError`
- `convolveDirectSampleCount` not needed — result length is the contract

**Golden cases (np.convolve):** impulse*anything; N=32 ramp * M=5 decaying exp; N=3 * M=3 known values; N=100 * M=1. Tolerance rtol 1e-12.

**Tests:** goldens; length = N+M−1; commutativity `conv(a,b)==conv(b,a)` ≤1e-12; associativity with third signal; delta identity; offset: conv of shifted inputs = shifted conv.

- [ ] Commit `feat(F10): direct linear convolution with golden tests`

### Task 2: Fast convolution (FFT, overlap-add)

**Files:** Modify `packages/dsp/src/systems/convolution.ts` (add `convolveFft`), golden not needed (property vs direct), test `packages/dsp/test/systems/convolutionFft.test.ts`; ALGORITHMS.md entry (overlap-add, reference Oppenheim & Schafer).

**Interfaces:**
- `convolveFft(x: Float64Array, h: Float64Array, { blockLengthSamples?: number }): Float64Array` — overlap-add with FFT block ≥ next_pow2 of (chosen block + M − 1); default block `pow2 ≥ M`; result length exactly N+M−1 (tail block handled — see Review Focus 1)
- Internal `nextPowerOfTwo(n: number): number` exported for tests

**Tests (property-first):** equivalence `convolveFft≈convolveDirect` ≤1e-10 for: N=1000 M=64; N=999 M=100 (non-aligned, non-pow2); N=64 M=1000 (IR longer than signal); N=100 M=33 with explicit tiny block 16; N=1; M=1; long: N=48000 M=4096 decays IR ≤1e-9; convolution theorem: `fft(conv) ≈ fft(x)·fft(h)` ≤1e-9 for N+M−1 ≤ 4096 padded.

- [ ] Commit `feat(F10): fft overlap-add convolution verified against direct`

### Task 3: FIR design — window method

**Files:** Create `packages/dsp/src/filters/fir.ts`, golden `algorithms/fir.py` → `golden/fir.json`, test `packages/dsp/test/filters/fir.test.ts`; ALGORITHMS.md entry (window method, reference: Smith *Intro to DSP*).

**Interfaces:**
- `designFirWindow({ band: "lowpass" | "highpass" | "bandpass" | "bandstop"; cutoffHz: number[]; taps: number; sampleRateHz: number; windowFilter: { kind: "hamming" | "blackman" | "kaiser"; beta?: number } }): Float64Array` — `cutoffHz.length` must match band (1 for lp/hp, 2 for bp/bs) → else RangeError; taps ≥ 3; normalized cutoff fc/(fs/2)
- Even tap counts allowed for all bands except exact-zero-Nyquist needs documented (test pins the behavior against scipy for even taps).
- Output normalized exactly like scipy `firwin` (scale= for lp sum=1; the golden script documents the equivalence of the two normalization conventions actually used).

**Golden cases (scipy.signal.firwin):** lowpass 31 taps hamming cutoff 4 kHz fs 48 k; highpass 32 taps; bandpass 41 taps blackman; bandstop 33 kaiser beta 5. Tolerance rtol 1e-9 (same window math).

**Tests:** goldens all four bands; symmetry (linear phase) ≤1e-12 for odd taps; DC gain of lowpass ≈ 1 and highpass ≈ 0 (≤1e-3); cutoff −6 dB point within ±1 bin of design cutoff (via `freqz` H4); guard: taps 2 → RangeError, mismatched cutoffs → RangeError.

- [ ] Commit `feat(F11): fir window-method design with scipy goldens`

### Task 4: IIR design — Butterworth, Chebyshev I, RBJ biquads

**Files:** Create `packages/dsp/src/filters/iir.ts`, `packages/dsp/src/filters/biquad.ts`, golden `algorithms/iir.py` → `golden/iir.json`, test `packages/dsp/test/filters/iir.test.ts`, `packages/dsp/test/filters/biquad.test.ts`; ALGORITHMS.md entries (bilinear transform; RBJ cookbook with formula list).

**Interfaces:**
- `designButterworth({ band, cutoffHz, order, sampleRateHz }): { b: Float64Array; a: Float64Array }` — analog prototype → bilinear transform, prewarped; **order ≤ 8** → else RangeError (numerical fragility pinned, documented)
- `designChebyshev1({ band, cutoffHz, order, rippleDb, sampleRateHz }): { b; a }` — order ≤ 8; rippleDb 0.1..3 → else RangeError
- RBJ biquads (exact cookbook formulas, BW or Q pinned as Q parameter): `biquadLowpass({ frequencyHz, q, sampleRateHz })`, `biquadHighpass`, `biquadPeaking({ frequencyHz, q, gainDb, sampleRateHz })`, `biquadNotch({ frequencyHz, q, sampleRateHz })` → all `{ b; a }` with a[0]=1 normalized
- `applyFilter(x: Float64Array, { b, a }): Float64Array` — direct-form II transposed, documented initial conditions = zero; result same length, with documented transient at start

**Golden cases (scipy.signal.butter/cheby1 with Wn normalized to fs/2, btype matching):** butter lp order 4 cutoff 2 kHz fs 48 k; butter hp order 2; butter bp order 4 cut 1–4 kHz; cheby1 lp order 5 ripple 1 dB; comparably for one bp. RBJ goldens: analytic cookbook evaluation in NumPy (the cookbook IS the definition; documented). Tolerance rtol 1e-9 for scipy coefficients; 1e-12 RBJ.

**Tests:** golden coefficient equality; pole-zero stability for every golden (all |z| < 1−1e-9); applyFilter on sine: lowpass keeps 1 kHz, attenuates 10 kHz ≥ 30 dB (order 4); biquad peaking +12 dB at center within 0.5 dB (via `freqz`); notch attenuation ≥ 40 dB at center; order 9 → RangeError.

- [ ] Commit `feat(F11): iir butterworth, chebyshev1 and rbj biquad design`

### Task 5: Filter analysis — freqz, group delay, pole-zero, stability

**Files:** Create `packages/dsp/src/filters/analysis.ts`, golden `algorithms/filter_analysis.py` → `golden/filter_analysis.json`, test `packages/dsp/test/filters/analysis.test.ts`; ALGORITHMS.md entry.

**Interfaces:**
- `freqz(b, a, { frequencies: number }): { frequencyHz: Float64Array; magnitude: Float64Array; phaseRad: Float64Array }` — hmm: requires sampleRateHz to emit Hz: signature `freqz(b, a, { numPoints: number; sampleRateHz: number })`; magnitude linear (dB conversion is the UI's job — but provide `magnitudeDb(magnitude): Float64Array` helper)
- `unwrapPhase(phase: Float64Array): Float64Array` — golden vs `np.unwrap`
- `groupDelaySamples(b, a, opts): Float64Array` — −dφ/dω finite difference, documented
- `impulseResponse(b, a, n: number): Float64Array`; `stepResponse(b, a, n: number): Float64Array`
- `polesZeros(b, a): { poles: Complex; zeros: Complex }` — roots via Durand–Kerner (documented, tolerance 1e-10) since no numeric library; complex type from plan 01
- `isStable(poles: Complex, tolerance?: number): boolean` — all |z| < 1 (strict)

**Golden cases (scipy.signal.freqz / group_delay / np.roots / np.unwrap):** butter lp order 4 — magnitude + unwrapped phase at 512 points; group delay 512 points; poles/zeros of that filter (sorted by modulus before compare); step response 64 samples. RBJ lowpass as second case. Tolerances: freqz 1e-9, roots 1e-8 (iterative), unwrap 1e-12.

**Tests:** goldens; Durand–Kerner on a known polynomial with random start roots: converge (determinism pinned by fixed initial guesses); isStable true for golden filters, false for poles [1.0], [1+1e-3·j]; group delay constant ≈ (N−1)/2 for symmetric FIR (plan-03 T3 output) within 1%.

- [ ] Commit `feat(F11): filter response analysis with pole-zero and stability`
