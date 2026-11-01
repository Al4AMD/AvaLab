/**
 * Purpose: F09 spectrum editor. Applies student edits (zero/scale/set on Re,
 * Im, magnitude or phase) to the DFT of a real frame, optionally restores
 * Hermitian symmetry, and returns the real IFFT signal plus the post-edit
 * one-sided spectra for the charts.
 *
 * Formula (SciPy convention, matching fftRadix2):
 *   X[k] = sum_{n=0}^{L-1} x[n] * e^(-j*2*pi*k*n/L)
 *   x[n] = (1/L) * sum_{k=0}^{L-1} X[k] * e^(+j*2*pi*k*n/L)
 * Edits address bins in [startBin, endBin), clamped to [0, L). Magnitude and
 * phase edits convert through m = hypot(re, im), phi = atan2(im, re):
 *   m/phi edit -> re = m*cos(phi), im = m*sin(phi)
 * Hermitian ON enforces X[L-k] = conj(X[k]) for k = 1..L/2-1 and zeroes the
 * imaginary parts of DC and Nyquist. OFF keeps the edited spectrum as-is; the
 * inverse is generally complex, so the returned signal is Re{x[n]} and the
 * imaginary-energy ratio reports how much was discarded.
 *
 * Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
 * sections 8.1-8.7 (DFT properties, Hermitian symmetry, circular convolution);
 * the rectangular analysis window and real-part fallback follow the Wave-3
 * Plan 05 ruling.
 *
 * Complexity: O(L log L) for the forward transform, O(L) for the edits, and
 * two O(L log L) inverse transforms (real and imaginary parts); O(L) space.
 *
 * Edge cases: empty input -> RangeError; non-finite sample -> TypeError;
 * non-integer/negative bin ranges, unknown target/mode, non-finite value ->
 * RangeError; fftLengthSamples not a power of two or smaller than the input
 * -> RangeError; L = 1 is legal; an all-zero real part reports ratio 0;
 * inputs are never mutated.
 */

import { mulberry32 } from "../signals/noise.js";
import { nextPowerOfTwo } from "../systems/convolution.js";
import { fftRadix2, ifftRadix2 } from "./fft.js";

export type SpectrumEditTarget = "re" | "im" | "mag" | "phase";
export type SpectrumEditMode = "zero" | "scale" | "set";

export interface SpectrumEdit {
  startBin: number;
  endBin: number;
  target: SpectrumEditTarget;
  mode: SpectrumEditMode;
  value: number;
}

export type SpectrumPreset =
  | "zeroIm"
  | "zeroRe"
  | "zeroPhase"
  | "linearPhase"
  | "randomPhase"
  | "magnitudeOnly"
  | "phaseOnly";

export interface EditSpectrumParams {
  fftLengthSamples?: number;
  edits: readonly SpectrumEdit[];
  hermitian: boolean;
}

export interface EditSpectrumResult {
  samples: Float64Array;
  re: Float64Array;
  im: Float64Array;
  magnitude: Float64Array;
  phase: Float64Array;
  imaginaryEnergyRatio: number;
}

const TARGETS: readonly SpectrumEditTarget[] = ["re", "im", "mag", "phase"];
const MODES: readonly SpectrumEditMode[] = ["zero", "scale", "set"];
const PRESETS: readonly SpectrumPreset[] = [
  "zeroIm",
  "zeroRe",
  "zeroPhase",
  "linearPhase",
  "randomPhase",
  "magnitudeOnly",
  "phaseOnly",
];

function isPowerOfTwo(size: number): boolean {
  return Number.isInteger(size) && size > 0 && (size & (size - 1)) === 0;
}

function assertFiniteSamples(samples: Float64Array): void {
  if (samples.length === 0) {
    throw new RangeError("editSpectrum: input must not be empty");
  }
  for (let index = 0; index < samples.length; index += 1) {
    const value: number | undefined = samples[index];
    if (value === undefined || !Number.isFinite(value)) {
      throw new TypeError(`editSpectrum: samples[${index}] must be finite (got ${String(value)})`);
    }
  }
}

function assertEdit(edit: SpectrumEdit, index: number, fftLengthSamples: number): void {
  if (edit === undefined || edit === null || typeof edit !== "object") {
    throw new RangeError(`editSpectrum: edits[${index}] must be an object`);
  }
  if (!Number.isInteger(edit.startBin) || edit.startBin < 0) {
    throw new RangeError(
      `editSpectrum: edits[${index}].startBin must be a non-negative integer (got ${String(edit.startBin)})`,
    );
  }
  if (!Number.isInteger(edit.endBin) || edit.endBin < edit.startBin) {
    throw new RangeError(
      `editSpectrum: edits[${index}].endBin must be an integer >= startBin (got ${String(edit.endBin)})`,
    );
  }
  if (!TARGETS.includes(edit.target)) {
    throw new RangeError(
      `editSpectrum: edits[${index}].target is unknown (${String(edit.target)})`,
    );
  }
  if (!MODES.includes(edit.mode)) {
    throw new RangeError(`editSpectrum: edits[${index}].mode is unknown (${String(edit.mode)})`);
  }
  if (!Number.isFinite(edit.value)) {
    throw new RangeError(
      `editSpectrum: edits[${index}].value must be finite (got ${String(edit.value)})`,
    );
  }
  if (edit.startBin >= fftLengthSamples) {
    // A range starting past the spectrum is a no-op, not a crash: the plan
    // clamps ranges to the spectrum.
    return;
  }
}

function applyEdit(
  re: Float64Array,
  im: Float64Array,
  edit: SpectrumEdit,
  fftLengthSamples: number,
): void {
  const start = Math.min(edit.startBin, fftLengthSamples);
  const end = Math.min(Math.max(edit.endBin, start), fftLengthSamples);
  for (let bin = start; bin < end; bin += 1) {
    const reValue = re[bin] ?? 0;
    const imValue = im[bin] ?? 0;
    if (edit.target === "re") {
      re[bin] =
        edit.mode === "zero" ? 0 : edit.mode === "scale" ? reValue * edit.value : edit.value;
    } else if (edit.target === "im") {
      im[bin] =
        edit.mode === "zero" ? 0 : edit.mode === "scale" ? imValue * edit.value : edit.value;
    } else if (edit.target === "mag") {
      const magnitude = Math.hypot(reValue, imValue);
      const phase = Math.atan2(imValue, reValue);
      const nextMagnitude =
        edit.mode === "zero" ? 0 : edit.mode === "scale" ? magnitude * edit.value : edit.value;
      if (nextMagnitude === 0) {
        re[bin] = 0;
        im[bin] = 0;
      } else {
        re[bin] = nextMagnitude * Math.cos(phase);
        im[bin] = nextMagnitude * Math.sin(phase);
      }
    } else {
      const magnitude = Math.hypot(reValue, imValue);
      const phase = Math.atan2(imValue, reValue);
      const nextPhase =
        edit.mode === "zero" ? 0 : edit.mode === "scale" ? phase * edit.value : edit.value;
      re[bin] = magnitude * Math.cos(nextPhase);
      im[bin] = magnitude * Math.sin(nextPhase);
    }
  }
}

/**
 * Applies an ordered list of band edits and returns the real IFFT signal
 * truncated to the input length plus the one-sided post-edit spectra.
 */
export function editSpectrum(
  samples: Float64Array,
  params: EditSpectrumParams,
): EditSpectrumResult {
  assertFiniteSamples(samples);
  if (params === undefined || params === null || !Array.isArray(params.edits)) {
    throw new RangeError("editSpectrum: params.edits must be an array");
  }
  if (typeof params.hermitian !== "boolean") {
    throw new RangeError("editSpectrum: params.hermitian must be a boolean");
  }
  const sampleCount = samples.length;
  const fftLengthSamples = params.fftLengthSamples ?? nextPowerOfTwo(sampleCount);
  if (!isPowerOfTwo(fftLengthSamples) || fftLengthSamples < sampleCount) {
    throw new RangeError(
      `editSpectrum: fftLengthSamples must be a power of two >= ${sampleCount} (got ${fftLengthSamples})`,
    );
  }

  const frame = new Float64Array(fftLengthSamples);
  frame.set(samples);
  const spectrum = fftRadix2(frame);

  for (let index = 0; index < params.edits.length; index += 1) {
    const edit = params.edits[index];
    if (edit === undefined) {
      throw new RangeError(`editSpectrum: edits[${index}] is missing`);
    }
    assertEdit(edit, index, fftLengthSamples);
    applyEdit(spectrum.re, spectrum.im, edit, fftLengthSamples);
  }

  if (params.hermitian) {
    const half = fftLengthSamples / 2;
    for (let bin = 1; bin < half; bin += 1) {
      const mirror = fftLengthSamples - bin;
      spectrum.re[mirror] = spectrum.re[bin] ?? 0;
      spectrum.im[mirror] = -(spectrum.im[bin] ?? 0);
    }
    spectrum.im[0] = 0;
    if (half >= 1) {
      spectrum.im[half] = 0;
    }
  }

  const realPart = ifftRadix2(spectrum);
  // Im{ifft(X)} = -Re{ifft(jX)}; jX has re = -im(X), im = re(X).
  const negatedImaginary = new Float64Array(fftLengthSamples);
  for (let bin = 0; bin < fftLengthSamples; bin += 1) {
    negatedImaginary[bin] = -(spectrum.im[bin] ?? 0);
  }
  const imaginaryPart = ifftRadix2({ re: negatedImaginary, im: spectrum.re });

  let realEnergy = 0;
  let imaginaryEnergy = 0;
  for (let index = 0; index < fftLengthSamples; index += 1) {
    const real = realPart[index] ?? 0;
    const imaginary = imaginaryPart[index] ?? 0;
    realEnergy += real * real;
    imaginaryEnergy += imaginary * imaginary;
  }
  const imaginaryEnergyRatio = realEnergy === 0 ? 0 : imaginaryEnergy / realEnergy;

  const binCount = Math.floor(fftLengthSamples / 2) + 1;
  const re = new Float64Array(binCount);
  const im = new Float64Array(binCount);
  const magnitude = new Float64Array(binCount);
  const phase = new Float64Array(binCount);
  for (let bin = 0; bin < binCount; bin += 1) {
    const reValue = spectrum.re[bin] ?? 0;
    const imValue = spectrum.im[bin] ?? 0;
    re[bin] = reValue;
    im[bin] = imValue;
    magnitude[bin] = Math.hypot(reValue, imValue);
    phase[bin] = Math.atan2(imValue, reValue);
  }

  return {
    samples: realPart.slice(0, sampleCount),
    re,
    im,
    magnitude,
    phase,
    imaginaryEnergyRatio,
  };
}

/**
 * Full-band preset edits. `binCount` is the one-sided bin count
 * (fftLength/2 + 1); phase presets emit one edit per bin because a single
 * numeric value cannot express a linear or random phase profile.
 */
export function buildSpectrumPreset(
  preset: SpectrumPreset,
  binCount: number,
  seed: number,
): SpectrumEdit[] {
  if (!PRESETS.includes(preset)) {
    throw new RangeError(`buildSpectrumPreset: unknown preset (${String(preset)})`);
  }
  if (!Number.isInteger(binCount) || binCount < 1) {
    throw new RangeError(
      `buildSpectrumPreset: binCount must be a positive integer (got ${binCount})`,
    );
  }
  if (!Number.isFinite(seed) || !Number.isInteger(seed)) {
    throw new RangeError(`buildSpectrumPreset: seed must be a finite integer (got ${seed})`);
  }
  switch (preset) {
    case "zeroIm":
      return [{ startBin: 0, endBin: binCount, target: "im", mode: "zero", value: 0 }];
    case "zeroRe":
      return [{ startBin: 0, endBin: binCount, target: "re", mode: "zero", value: 0 }];
    case "zeroPhase":
    case "magnitudeOnly":
      return [{ startBin: 0, endBin: binCount, target: "phase", mode: "set", value: 0 }];
    case "phaseOnly":
      return [{ startBin: 0, endBin: binCount, target: "mag", mode: "set", value: 1 }];
    case "linearPhase": {
      const edits: SpectrumEdit[] = [];
      for (let bin = 0; bin < binCount; bin += 1) {
        edits.push({
          startBin: bin,
          endBin: bin + 1,
          target: "phase",
          mode: "set",
          value: bin === 0 ? 0 : (-Math.PI * bin) / binCount,
        });
      }
      return edits;
    }
    case "randomPhase": {
      const random = mulberry32(seed);
      const edits: SpectrumEdit[] = [];
      for (let bin = 0; bin < binCount; bin += 1) {
        edits.push({
          startBin: bin,
          endBin: bin + 1,
          target: "phase",
          mode: "set",
          value: (2 * random() - 1) * Math.PI,
        });
      }
      return edits;
    }
  }
}
