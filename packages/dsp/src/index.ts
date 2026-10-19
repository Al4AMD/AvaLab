/**
 * Purpose: public entry point of @avalab/dsp, the pure TypeScript DSP library.
 * Wave 1 adds algorithm folders (fourier/, stft/, filters/, ...) beside utils/.
 *
 * Formula: n/a (re-export barrel).
 *
 * Reference: AGENTS section 11 (DSP library rules).
 *
 * Complexity: n/a.
 *
 * Edge cases: n/a; every exported function documents its own.
 */

export type { Complex } from "./fourier/complex.js";
export { dftNaive, idftNaive } from "./fourier/dft.js";
export { fftRadix2, ifftRadix2 } from "./fourier/fft.js";
export { averagePowerOf, energyOf } from "./utils/energy.js";
export { samplesToSeconds, secondsToSamples } from "./utils/time.js";
