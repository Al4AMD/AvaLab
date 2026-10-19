/**
 * Purpose: short-time Fourier transform (STFT) analysis and its inverse (ISTFT)
 * with overlap-add synthesis (F08; plan 04 phase vocoder consumes this
 * interface). The STFT slides a window over the signal, transforms each windowed
 * frame, and stores one full-length spectrum per frame; the inverse re-applies
 * the analysis window, overlap-adds the frames, and divides each output sample
 * by the sum of squared window weights that covered it, so any window/hop pair
 * reconstructs the original signal wherever that weight sum is nonzero.
 *
 * Formulas (N = input length, L = frameLengthSamples, H = hopLengthSamples,
 * F = fftLengthSamples, w = window of length L, M = ceil(N / H) frames):
 *
 * Analysis, frame m = 0..M-1 (frame m starts at m*H; samples past N are zero):
 *   y_m[n] = x[m*H + n] for n = 0..L-1 (zero outside [0, N))
 *   X_m[k] = sum_{n=0}^{L-1} w[n] * y_m[n] * e^(-j*2*pi*k*n/F),
 *   k = 0..F-1, where y_m is zero-padded from L to F.
 * The forward transform is UNNORMALIZED (no 1/F), matching fft/ifft in this
 * library and SciPy's fft convention.
 *
 * Synthesis (unnormalized inverse, real part, then window + overlap-add):
 *   x_m[n] = (1/F) * Re{ sum_{k=0}^{F-1} X_m[k] * e^(+j*2*pi*k*n/F) },
 *   n = 0..L-1
 *   y[n]   = sum_m w[n - m*H] * x_m[n - m*H]
 *   S[n]   = sum_m w[n - m*H]^2
 *   out[n] = y[n] / S[n] for S[n] > 0, and 0 where S[n] = 0 (R16).
 * The output is trimmed to originalLengthSamples. Dividing by S makes the
 * synthesis satisfy the weighted overlap-add (WOLA) condition rather than only
 * COLA: for S[n] > 0 the same window on analysis and synthesis cancels exactly.
 *
 * Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
 * sections 10.3-10.4 (short-time Fourier analysis and overlap-add synthesis);
 * Griffin & Lim, "Signal estimation from modified short-time Fourier
 * transform", IEEE Trans. ASSP 32(2), 1984 (weighted overlap-add synthesis).
 * SciPy `scipy.signal.stft` with `scaling="spectrum"`, `boundary=None`,
 * `padded=False` divides each unnormalized FFT by `window.sum()`; multiplying
 * that output by `window.sum()` gives exactly the convention above (pinned by
 * an assertion in tools/golden stft.py). SciPy `scipy.signal.istft` uses the
 * same window-energy normalization used here.
 *
 * Complexity: O(M * F * log F) time and O(M * F) space for `stft`;
 * `istft` uses O(M * F * log F) time for the inverse transforms plus O(M * L)
 * for the overlap-add, and O(originalLengthSamples) output space.
 *
 * Edge cases: M = 0 for empty input (no frames; `istft` then returns an empty
 * array). The last frame is zero-padded beyond N, and its spectrum is still
 * stored. `frameLengthSamples`, `hopLengthSamples` and `fftLengthSamples` must
 * be integers with L >= 1, H >= 1 and F >= L -> RangeError otherwise; the
 * window length must equal L -> RangeError. `istft` additionally requires
 * H <= L, every frame to hold exactly F bins, and originalLengthSamples to be
 * a non-negative integer that does not exceed the covered length
 * (M - 1) * H + L, where M = 0 covers 0 samples -> RangeError. The coverage
 * check runs before the empty-frames fast path, so zero frames with a
 * positive originalLengthSamples is rejected instead of silently returning
 * empty. A NaN or
 * +/-Infinity sample, window value or spectrum value -> TypeError. Window
 * energy S[n] = 0 yields 0 for that sample instead of a division by zero
 * (periodic hann has w[0] = 0, so the first output sample of a single-frame
 * analysis is 0). Inputs are never mutated; the returned window is a copy.
 */

import type { Complex } from "./complex.js";
import { fft, ifft } from "./transform.js";

export interface StftParams {
  frameLengthSamples: number;
  hopLengthSamples: number;
  fftLengthSamples: number;
  window: Float64Array;
}

export interface StftResult {
  frames: Complex[];
  frameLengthSamples: number;
  hopLengthSamples: number;
  fftLengthSamples: number;
  /** Copy of the analysis window (needed by `istft`). */
  window: Float64Array;
  /** Input length N before frame padding, used to trim the inverse output. */
  originalLengthSamples: number;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be an integer >= 1 (got ${value})`);
  }
}

function assertFiniteValues(values: Float64Array, label: string): void {
  for (let index = 0; index < values.length; index += 1) {
    const value: number | undefined = values[index];
    if (value === undefined) {
      throw new TypeError(`${label}[${index}] read out of bounds`);
    }
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label}[${index}] is not finite (${value})`);
    }
  }
}

function validateAnalysisParams(params: StftParams, caller: string): void {
  assertPositiveInteger(params.frameLengthSamples, `${caller}: frameLengthSamples`);
  assertPositiveInteger(params.hopLengthSamples, `${caller}: hopLengthSamples`);
  assertPositiveInteger(params.fftLengthSamples, `${caller}: fftLengthSamples`);
  if (params.fftLengthSamples < params.frameLengthSamples) {
    throw new RangeError(
      `${caller}: fftLengthSamples (${params.fftLengthSamples}) must be >= frameLengthSamples (${params.frameLengthSamples})`,
    );
  }
  if (params.window.length !== params.frameLengthSamples) {
    throw new RangeError(
      `${caller}: window length ${params.window.length} does not match frameLengthSamples ${params.frameLengthSamples}`,
    );
  }
  assertFiniteValues(params.window, `${caller}: window`);
}

/** Forward STFT: one unnormalized FFT of length F per windowed frame. */
export function stft(x: Float64Array, params: StftParams): StftResult {
  validateAnalysisParams(params, "stft");
  assertFiniteValues(x, "stft: x");

  const { frameLengthSamples, hopLengthSamples, fftLengthSamples } = params;
  const frameCount = x.length === 0 ? 0 : Math.ceil(x.length / hopLengthSamples);
  const frames: Complex[] = [];
  const frame = new Float64Array(fftLengthSamples);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    frame.fill(0);
    const start = frameIndex * hopLengthSamples;
    const available = Math.min(frameLengthSamples, x.length - start);
    for (let n = 0; n < available; n += 1) {
      const sample: number | undefined = x[start + n];
      const weight: number | undefined = params.window[n];
      if (sample === undefined || weight === undefined) {
        throw new TypeError(`stft: frame ${frameIndex} sample ${n} read out of bounds`);
      }
      frame[n] = sample * weight;
    }
    frames.push(fft(frame));
  }

  return {
    frames,
    frameLengthSamples,
    hopLengthSamples,
    fftLengthSamples,
    window: params.window.slice(),
    originalLengthSamples: x.length,
  };
}

/** Inverse STFT with weighted overlap-add and per-sample window-energy normalization. */
export function istft(result: StftResult): Float64Array {
  const {
    frames,
    frameLengthSamples,
    hopLengthSamples,
    fftLengthSamples,
    window: analysisWindow,
    originalLengthSamples,
  } = result;

  assertPositiveInteger(frameLengthSamples, "istft: frameLengthSamples");
  assertPositiveInteger(hopLengthSamples, "istft: hopLengthSamples");
  assertPositiveInteger(fftLengthSamples, "istft: fftLengthSamples");
  if (fftLengthSamples < frameLengthSamples) {
    throw new RangeError(
      `istft: fftLengthSamples (${fftLengthSamples}) must be >= frameLengthSamples (${frameLengthSamples})`,
    );
  }
  if (hopLengthSamples > frameLengthSamples) {
    throw new RangeError(
      `istft: hopLengthSamples (${hopLengthSamples}) must be <= frameLengthSamples (${frameLengthSamples})`,
    );
  }
  if (analysisWindow.length !== frameLengthSamples) {
    throw new RangeError(
      `istft: window length ${analysisWindow.length} does not match frameLengthSamples ${frameLengthSamples}`,
    );
  }
  if (!Number.isInteger(originalLengthSamples) || originalLengthSamples < 0) {
    throw new RangeError(
      `istft: originalLengthSamples must be an integer >= 0 (got ${originalLengthSamples})`,
    );
  }
  assertFiniteValues(analysisWindow, "istft: window");

  const paddedLength =
    frames.length === 0 ? 0 : (frames.length - 1) * hopLengthSamples + frameLengthSamples;
  if (originalLengthSamples > paddedLength) {
    throw new RangeError(
      `istft: originalLengthSamples (${originalLengthSamples}) exceeds the ${paddedLength} samples covered by ${frames.length} frames`,
    );
  }
  if (frames.length === 0) {
    return new Float64Array(0);
  }

  const accumulated = new Float64Array(paddedLength);
  const windowEnergy = new Float64Array(paddedLength);

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex];
    if (frame === undefined) {
      throw new TypeError(`istft: frame ${frameIndex} read out of bounds`);
    }
    if (frame.re.length !== fftLengthSamples || frame.im.length !== fftLengthSamples) {
      throw new RangeError(
        `istft: frame ${frameIndex} holds ${frame.re.length} re and ${frame.im.length} im bins, expected fftLengthSamples ${fftLengthSamples}`,
      );
    }
    const restored = ifft(frame);
    const start = frameIndex * hopLengthSamples;
    for (let n = 0; n < frameLengthSamples; n += 1) {
      const weight: number | undefined = analysisWindow[n];
      const value: number | undefined = restored[n];
      if (weight === undefined || value === undefined) {
        throw new TypeError(`istft: frame ${frameIndex} sample ${n} read out of bounds`);
      }
      accumulated[start + n] = (accumulated[start + n] ?? 0) + weight * value;
      windowEnergy[start + n] = (windowEnergy[start + n] ?? 0) + weight * weight;
    }
  }

  const output = new Float64Array(paddedLength);
  for (let n = 0; n < paddedLength; n += 1) {
    const energy: number | undefined = windowEnergy[n];
    const value: number | undefined = accumulated[n];
    if (energy === undefined || value === undefined) {
      throw new TypeError(`istft: output sample ${n} read out of bounds`);
    }
    output[n] = energy > 0 ? value / energy : 0;
  }
  return output.slice(0, originalLengthSamples);
}
