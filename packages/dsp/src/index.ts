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

export type {
  FirBand,
  FirWindowFilter,
  FirWindowKind,
  FirWindowOptions,
} from "./filters/fir.js";
export { designFirWindow } from "./filters/fir.js";
export { fftBluestein } from "./fourier/bluestein.js";
export type { Complex } from "./fourier/complex.js";
export { dftNaive, idftNaive } from "./fourier/dft.js";
export { fftRadix2, ifftRadix2 } from "./fourier/fft.js";
export { irfft, rfft } from "./fourier/rfft.js";
export type { StftParams, StftResult } from "./fourier/stft.js";
export { istft, stft } from "./fourier/stft.js";
export { fft, ifft } from "./fourier/transform.js";
export type { WindowKind } from "./fourier/windows.js";
export { i0, kaiser, window, windowSymmetric } from "./fourier/windows.js";
export type { PsnrOptions, SegmentalSnrOptions } from "./metrics/basic.js";
export {
  bitrateKbps,
  compressionRatio,
  mse,
  psnrDb,
  segmentalSnrDb,
  snrDb,
} from "./metrics/basic.js";
export type { CompandingOptions } from "./metrics/companding.js";
export { alawDecode, alawEncode, mulawDecode, mulawEncode } from "./metrics/companding.js";
export { entropyBitsPerSymbol } from "./metrics/entropy.js";
export type { TpdfDitherOptions, UniformQuantizeOptions } from "./metrics/quantize.js";
export {
  quantizationError,
  quantizeUniform,
  quantizeWithTpdfDither,
} from "./metrics/quantize.js";
export type {
  ResampleFilter,
  ResampleRationalOptions,
} from "./resample/resample.js";
export { resampleRational } from "./resample/resample.js";
export type { LowpassSincOptions } from "./resample/windowedSinc.js";
export { designLowpassSinc } from "./resample/windowedSinc.js";
export type {
  FloatArray,
  SignalType,
  SupportOptions,
  SupportRange,
} from "./signals/extent.js";
export {
  averagePower,
  classifySignalType,
  reverse,
  signalEnergy,
  support,
  timeScale,
  timeShift,
  truncate,
  zeroPad,
} from "./signals/extent.js";
export type { FourierSeriesKind, FourierSeriesSpec } from "./signals/fourierSeries.js";
export { fourierSeriesPartialSum, measureGibbsOvershoot } from "./signals/fourierSeries.js";
export type { SignalSpec } from "./signals/generators.js";
export {
  generateAm,
  generateChirp,
  generateFm,
  generateImpulse,
  generateSawtooth,
  generateSine,
  generateSquare,
  generateStep,
  generateTriangle,
  generateTwoTone,
} from "./signals/generators.js";
export { generatePinkNoise, generateWhiteNoise, mulberry32 } from "./signals/noise.js";
export type { ConvolveFftOptions } from "./systems/convolution.js";
export { convolveDirect, convolveFft, nextPowerOfTwo } from "./systems/convolution.js";
export { averagePowerOf, energyOf } from "./utils/energy.js";
export { samplesToSeconds, secondsToSamples } from "./utils/time.js";
