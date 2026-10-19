/**
 * Purpose: naive O(N^2) discrete Fourier transform and its inverse. This is
 * the slow, obviously-correct reference that the fast radix-2 FFT (F08) and
 * every later spectrum tool are validated against.
 *
 * Formula (SciPy convention, used everywhere in this library):
 *   Forward:  X[k] = sum_{n=0}^{N-1} x[n] * e^(-j*2*pi*k*n/N),  k = 0..N-1
 *   Inverse:  x[n] = (1/N) * sum_{k=0}^{N-1} X[k] * e^(+j*2*pi*k*n/N)
 * There is no other scaling anywhere: the forward transform is unscaled and
 * the inverse carries exactly 1/N.
 *
 * Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
 * section 8.1 (the discrete Fourier transform).
 *
 * Complexity: O(N^2) time, O(N) space.
 *
 * Edge cases: empty input -> zero-length Complex / Float64Array; N = 1 is the
 * identity; a NaN or +/-Infinity sample or spectrum value -> TypeError; the
 * inverse rejects a Complex whose re/im lengths differ. idftNaive returns only
 * the real part on purpose: spectra produced by this library describe real
 * signals, whose Hermitian-symmetric inverse is real up to roundoff, and
 * returning Re{...} states that contract explicitly (the golden vectors pin
 * scipy.fft.ifft(X).real). A caller that edits a spectrum without Hermitian
 * symmetry can still use the result as Re{...}; a full complex inverse, if a
 * later tool needs it, is a separate function with its own contract.
 */

import type { Complex } from "./complex.js";

const TAU = 2 * Math.PI;

function finiteAt(values: Float64Array, index: number, label: string): number {
  const value: number | undefined = values[index];
  if (value === undefined) {
    throw new TypeError(`${label}[${index}] read out of bounds`);
  }
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label}[${index}] is not finite (${value})`);
  }
  return value;
}

export function dftNaive(samples: Float64Array): Complex {
  const sampleCount = samples.length;
  const re = new Float64Array(sampleCount);
  const im = new Float64Array(sampleCount);
  for (let k = 0; k < sampleCount; k += 1) {
    let sumRe = 0;
    let sumIm = 0;
    for (let n = 0; n < sampleCount; n += 1) {
      const sample = finiteAt(samples, n, "dftNaive: samples");
      // Reduce the phase modulo N (exact for integer k*n) before calling
      // sin/cos: the twiddle factor is 2*pi-periodic, and keeping the
      // argument small avoids large-argument reduction error.
      const angle = (-TAU * ((k * n) % sampleCount)) / sampleCount;
      sumRe += sample * Math.cos(angle);
      sumIm += sample * Math.sin(angle);
    }
    re[k] = sumRe;
    im[k] = sumIm;
  }
  return { re, im };
}

export function idftNaive(spectrum: Complex): Float64Array {
  const binCount = spectrum.re.length;
  if (spectrum.im.length !== binCount) {
    throw new TypeError(
      `idftNaive: re length ${binCount} does not match im length ${spectrum.im.length}`,
    );
  }
  if (binCount === 0) {
    return new Float64Array(0);
  }
  const samples = new Float64Array(binCount);
  for (let n = 0; n < binCount; n += 1) {
    let sumRe = 0;
    for (let k = 0; k < binCount; k += 1) {
      const re = finiteAt(spectrum.re, k, "idftNaive: re");
      const im = finiteAt(spectrum.im, k, "idftNaive: im");
      // Same modulo-N phase reduction as the forward transform.
      const angle = (TAU * ((k * n) % binCount)) / binCount;
      sumRe += re * Math.cos(angle) - im * Math.sin(angle);
    }
    samples[n] = sumRe / binCount;
  }
  return samples;
}
