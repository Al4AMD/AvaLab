/**
 * Purpose: real-input FFT (F08) and its inverse. A real signal x[n] has the
 * Hermitian-symmetric spectrum X[N-k] = conj(X[k]), so only the bins
 * k = 0..floor(N/2) carry information; `rfft` returns exactly that
 * half-spectrum and `irfft` rebuilds the full spectrum by conjugate mirroring
 * before inverting. UI tools that show |X[k]| or the magnitude/phase editor
 * (F09) consume these to halve the stored spectrum of real audio.
 *
 * Formula (SciPy convention, used everywhere in this library):
 *   Forward:  X[k] = sum_{n=0}^{N-1} x[n] * e^(-j*2*pi*k*n/N),  k = 0..floor(N/2)
 *   Inverse:  x[n] = (1/N) * sum_{k=0}^{N-1} X[k] * e^(+j*2*pi*k*n/N)
 * with the full spectrum of the inverse reconstructed as:
 *   X[k] = X[N-k]* (complex conjugate) for k = floor(N/2)+1 .. N-1.
 * The forward transform is unscaled; the inverse carries exactly 1/N.
 * For real x, Im{X[0]} = 0 and, when N is even, Im{X[N/2]} = 0.
 *
 * Implementation note (correctness over optimization): `rfft` computes the
 * full complex `fft` and slices the first floor(N/2)+1 bins. The real-FFT
 * packing optimization (one N/2 complex transform) is deliberately skipped;
 * the library is Float64 throughout and half a spectrum of extra work does
 * not affect the UI budgets of AGENTS section 9. `irfft` likewise builds the
 * full Complex and delegates to `ifft`.
 *
 * Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
 * section 8.1 (symmetry properties for real sequences) and section 9.3
 * (computation via the complex FFT); SciPy's rfft/irfft define the golden
 * vectors.
 *
 * Complexity: O(N log N) time, O(N) space for both functions.
 *
 * Edge cases: N = 0 -> empty spectrum / empty samples (the half-spectrum of
 * the empty transform is empty, not one bin); N = 1 -> one real bin and the
 * identity inverse; a NaN or +/-Infinity sample or spectrum value -> TypeError;
 * `irfft` requires exactly floor(N/2)+1 bins in each of re/im -> RangeError
 * otherwise; `originalLength` must be a non-negative integer -> RangeError
 * otherwise; the edge bins k = 0 and k = N/2 (even N) must be real within
 * max(1e-12, 1e-9 * peakMagnitude) or -> RangeError (Hermitian-symmetry
 * validation). Neither function mutates its inputs.
 */

import type { Complex } from "./complex.js";
import { fft, ifft } from "./transform.js";

function valueAt(values: Float64Array, index: number, label: string): number {
  const value: number | undefined = values[index];
  if (value === undefined) {
    throw new TypeError(`${label}[${index}] read out of bounds`);
  }
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label}[${index}] is not finite (${value})`);
  }
  return value;
}

function assertOriginalLength(originalLength: number): void {
  if (!Number.isInteger(originalLength) || originalLength < 0) {
    throw new RangeError(
      `irfft: originalLength must be a non-negative integer (got ${originalLength})`,
    );
  }
}

export function rfft(samples: Float64Array): Complex {
  const size = samples.length;
  if (size === 0) {
    return { re: new Float64Array(0), im: new Float64Array(0) };
  }
  const halfSpectrum = fft(samples);
  const binCount = Math.floor(size / 2) + 1;
  return { re: halfSpectrum.re.slice(0, binCount), im: halfSpectrum.im.slice(0, binCount) };
}

export function irfft(spectrum: Complex, originalLength: number): Float64Array {
  assertOriginalLength(originalLength);
  const size = originalLength;
  const reLength = spectrum.re.length;
  if (size === 0) {
    if (reLength !== 0 || spectrum.im.length !== 0) {
      throw new RangeError(
        `irfft: N = 0 expects 0 bins, got ${reLength} re and ${spectrum.im.length} im`,
      );
    }
    return new Float64Array(0);
  }
  if (spectrum.im.length !== reLength) {
    throw new RangeError(
      `irfft: re length ${reLength} does not match im length ${spectrum.im.length}`,
    );
  }
  const binCount = Math.floor(size / 2) + 1;
  if (reLength !== binCount) {
    throw new RangeError(`irfft: N = ${size} expects ${binCount} bins, got ${reLength}`);
  }

  // Validate finiteness before arithmetic so NaN never leaks into the mirror
  // or the magnitude scan.
  for (let k = 0; k < binCount; k += 1) {
    valueAt(spectrum.re, k, "irfft: re");
    valueAt(spectrum.im, k, "irfft: im");
  }

  let peakMagnitude = 0;
  for (let k = 0; k < binCount; k += 1) {
    const re = valueAt(spectrum.re, k, "irfft: re");
    const im = valueAt(spectrum.im, k, "irfft: im");
    peakMagnitude = Math.max(peakMagnitude, Math.hypot(re, im));
  }

  // The DC bin and (for even N) the Nyquist bin of a real signal are real.
  // Roundoff in a user-edited or codec-produced half-spectrum may leave a
  // negligible imaginary residue, so allow max(1e-12, 1e-9 * peak).
  const edgeBinTolerance = Math.max(1e-12, 1e-9 * peakMagnitude);
  const edgeBins = size % 2 === 0 ? [0, size / 2] : [0];
  for (const k of edgeBins) {
    const edgeIm = valueAt(spectrum.im, k, "irfft: im");
    if (Math.abs(edgeIm) > edgeBinTolerance) {
      throw new RangeError(
        `irfft: edge bin k = ${k} must be real for a real signal ` +
          `(Im = ${edgeIm} exceeds ${edgeBinTolerance})`,
      );
    }
  }

  const fullRe = new Float64Array(size);
  const fullIm = new Float64Array(size);
  for (let k = 0; k < binCount; k += 1) {
    fullRe[k] = valueAt(spectrum.re, k, "irfft: re");
    fullIm[k] = valueAt(spectrum.im, k, "irfft: im");
  }
  for (let k = binCount; k < size; k += 1) {
    const mirror = size - k;
    fullRe[k] = valueAt(spectrum.re, mirror, "irfft: re");
    fullIm[k] = -valueAt(spectrum.im, mirror, "irfft: im");
  }

  return ifft({ re: fullRe, im: fullIm });
}
