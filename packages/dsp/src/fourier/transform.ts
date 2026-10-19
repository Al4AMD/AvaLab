/**
 * Purpose: the FFT entry points used by every frequency-domain tool. `fft`
 * dispatches to the radix-2 Cooley-Tukey transform for power-of-two lengths
 * and to the Bluestein chirp-z transform otherwise, so callers never need to
 * check or pad their transform size. `ifft` is the matching inverse for any
 * length and returns the real part, mirroring ifftRadix2.
 *
 * Formula (SciPy convention, used everywhere in this library):
 *   Forward:  X[k] = sum_{n=0}^{N-1} x[n] * e^(-j*2*pi*k*n/N)
 *   Inverse:  x[n] = (1/N) * sum_{k=0}^{N-1} X[k] * e^(+j*2*pi*k*n/N)
 * There is no other scaling: the forward transform is unscaled and the inverse
 * carries exactly 1/N.
 *
 * `fft` delegates without touching the samples; power-of-two sizes therefore
 * produce bit-for-bit the same output as fftRadix2. `ifft` uses the conjugate
 * trick on the complex spectrum split into real and imaginary parts:
 *   ifft(X) = conj(FFT(conj X)) / N, and FFT(conj X) = FFT(Re X) - j*FFT(Im X).
 * Hence Re{ifft X}[n] = (Re{FFT(Re X)}[n] + Im{FFT(Im X)}[n]) / N.
 *
 * Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
 * sections 8.1 and 9.3; Bluestein (1970) and Rabiner, Schafer & Rader (1969)
 * for the arbitrary-length transform (see bluestein.ts). SciPy's fft/ifft
 * define the golden vectors.
 *
 * Complexity: O(N log N) time, O(N) space for both functions.
 *
 * Edge cases: empty input/spectrum -> zero-length result; N = 1 is the
 * identity; a NaN or +/-Infinity sample or spectrum value -> TypeError; a
 * Complex whose re/im lengths differ -> TypeError for ifft. Inputs are never
 * mutated. ifft returns only the real part on purpose: spectra produced by
 * this library describe real signals, whose Hermitian-symmetric inverse is
 * real up to roundoff (the golden vectors pin scipy.fft.ifft(X).real). A
 * caller that edits a spectrum without Hermitian symmetry can still use the
 * result as Re{...}; a full complex inverse is a separate function with its
 * own contract.
 */

import { fftBluestein } from "./bluestein.js";
import type { Complex } from "./complex.js";
import { fftRadix2 } from "./fft.js";

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

function isPowerOfTwo(size: number): boolean {
  // Bitwise test is exact for every size a typed array can hold.
  return size > 0 && (size & (size - 1)) === 0;
}

export function fft(samples: Float64Array): Complex {
  const size = samples.length;
  if (size === 0) {
    return { re: new Float64Array(0), im: new Float64Array(0) };
  }
  return isPowerOfTwo(size) ? fftRadix2(samples) : fftBluestein(samples);
}

export function ifft(spectrum: Complex): Float64Array {
  const size = spectrum.re.length;
  if (spectrum.im.length !== size) {
    throw new TypeError(`ifft: re length ${size} does not match im length ${spectrum.im.length}`);
  }
  if (size === 0) {
    return new Float64Array(0);
  }

  const reSpectrum = fft(spectrum.re);
  const imSpectrum = fft(spectrum.im);
  const samples = new Float64Array(size);
  for (let n = 0; n < size; n += 1) {
    const reRe = valueAt(reSpectrum.re, n, "ifft: re spectrum re");
    const imIm = valueAt(imSpectrum.im, n, "ifft: im spectrum im");
    samples[n] = (reRe + imIm) / size;
  }
  return samples;
}
