/**
 * Purpose: Bluestein (chirp-z) FFT for arbitrary transform lengths. The
 * radix-2 transform in fft.ts requires a power-of-two size, so this file turns
 * the length-N DFT into a circular convolution of length m = next_pow2(2N-1)
 * and evaluates that convolution with the radix-2 kernels.
 *
 * Formula (SciPy convention, used everywhere in this library):
 *   X[k] = sum_{n=0}^{N-1} x[n] * e^(-j*2*pi*k*n/N)
 * The forward transform is unscaled. The Bluestein identity is
 *   k*n = (n^2 + k^2 - (k-n)^2) / 2,
 * so with the chirp b[n] = e^(-j*pi*n^2/N):
 *   X[k] = b[k] * sum_{n=0}^{N-1} (x[n]*b[n]) * conj(b[k-n]).
 * The sum is a linear (not circular) convolution of a[n] = x[n]*b[n] with
 * c[d] = conj(b[d]). Padding a to length m >= 2N-1 and wrapping c
 * periodically (c[m-d] = c[d]) makes the length-m circular convolution equal
 * to that linear convolution for every k = 0..N-1.
 *
 * Circular convolution is evaluated with two real-input radix-2 transforms:
 * a and c are complex, so a complex forward FFT is assembled from the real
 * transforms of its real and imaginary parts (linearity), and the inverse uses
 * the conjugate trick ifft(Z) = conj(FFT(conj Z))/m. The resulting spectra are
 * multiplied pointwise and transformed back. The chirp phase is reduced
 * modulo 2N before sin/cos because e^(-j*pi*n^2/N) has period 2N in n^2;
 * keeping the angle argument small avoids large-argument reduction error.
 *
 * Reference: L. I. Bluestein, "A linear filtering approach to the computation
 * of discrete Fourier transform", IEEE Trans. Audio Electroacoustics, vol. 18,
 * no. 4, pp. 451-455, 1970; Rabiner, Schafer & Rader, "The chirp z-transform
 * algorithm", Bell System Technical Journal, vol. 48, no. 5, pp. 1249-1292,
 * 1969. SciPy's fft defines the golden vectors.
 *
 * Complexity: O(N log N) time, O(N) space (all working arrays have length
 * m < 4N).
 *
 * Edge cases: empty input -> zero-length Complex; N = 1 is the identity (m = 1
 * and the radix-2 transform of length 1 is also the identity); a NaN or
 * +/-Infinity sample -> TypeError; the input is never mutated and every output
 * array is freshly allocated.
 */

import type { Complex } from "./complex.js";
import { fftRadix2 } from "./fft.js";

const PI = Math.PI;

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

function nextPowerOfTwoAtLeast(minimum: number): number {
  let size = 1;
  while (size < minimum) {
    size *= 2;
  }
  return size;
}

/**
 * Complex FFT built from two real-input radix-2 transforms:
 * FFT(re + j*im) = FFT(re) + j*FFT(im).
 */
function complexFft(re: Float64Array, im: Float64Array): Complex {
  const size = re.length;
  const reSpectrum = fftRadix2(re);
  const imSpectrum = fftRadix2(im);
  const outRe = new Float64Array(size);
  const outIm = new Float64Array(size);
  for (let k = 0; k < size; k += 1) {
    const reRe = valueAt(reSpectrum.re, k, "fftBluestein: re spectrum re");
    const reIm = valueAt(reSpectrum.im, k, "fftBluestein: re spectrum im");
    const imRe = valueAt(imSpectrum.re, k, "fftBluestein: im spectrum re");
    const imIm = valueAt(imSpectrum.im, k, "fftBluestein: im spectrum im");
    // (reRe + j*reIm) + j*(imRe + j*imIm)
    outRe[k] = reRe - imIm;
    outIm[k] = reIm + imRe;
  }
  return { re: outRe, im: outIm };
}

/**
 * Complex inverse FFT via the conjugate trick:
 * ifft(Z) = conj(FFT(conj Z)) / m, with FFT(conj Z) = FFT(Re Z) - j*FFT(Im Z).
 * Therefore Re{ifft Z}[n] = (Re{FFT(Re Z)}[n] + Im{FFT(Im Z)}[n]) / m and
 * Im{ifft Z}[n] = (Re{FFT(Im Z)}[n] - Im{FFT(Re Z)}[n]) / m.
 */
function complexIfft(spectrum: Complex): Complex {
  const size = spectrum.re.length;
  const reSpectrum = fftRadix2(spectrum.re);
  const imSpectrum = fftRadix2(spectrum.im);
  const outRe = new Float64Array(size);
  const outIm = new Float64Array(size);
  for (let n = 0; n < size; n += 1) {
    const reRe = valueAt(reSpectrum.re, n, "fftBluestein: inverse re re");
    const reIm = valueAt(reSpectrum.im, n, "fftBluestein: inverse re im");
    const imRe = valueAt(imSpectrum.re, n, "fftBluestein: inverse im re");
    const imIm = valueAt(imSpectrum.im, n, "fftBluestein: inverse im im");
    outRe[n] = (reRe + imIm) / size;
    outIm[n] = (imRe - reIm) / size;
  }
  return { re: outRe, im: outIm };
}

export function fftBluestein(samples: Float64Array): Complex {
  const sampleCount = samples.length;
  if (sampleCount === 0) {
    return { re: new Float64Array(0), im: new Float64Array(0) };
  }
  // Reject bad samples before allocating the padded working buffers.
  for (let index = 0; index < sampleCount; index += 1) {
    valueAt(samples, index, "fftBluestein: samples");
  }

  const convolutionSize = nextPowerOfTwoAtLeast(2 * sampleCount - 1);

  // Chirp b[n] = exp(-j*pi*n^2/N), phase reduced modulo 2N.
  const chirpRe = new Float64Array(sampleCount);
  const chirpIm = new Float64Array(sampleCount);
  for (let n = 0; n < sampleCount; n += 1) {
    const phaseNumerator = (n * n) % (2 * sampleCount);
    const angle = (-PI * phaseNumerator) / sampleCount;
    chirpRe[n] = Math.cos(angle);
    chirpIm[n] = Math.sin(angle);
  }

  // a[n] = x[n] * b[n], zero-padded to the convolution length.
  const aRe = new Float64Array(convolutionSize);
  const aIm = new Float64Array(convolutionSize);
  for (let n = 0; n < sampleCount; n += 1) {
    const sample = valueAt(samples, n, "fftBluestein: samples");
    const bRe = valueAt(chirpRe, n, "fftBluestein: chirpRe");
    const bIm = valueAt(chirpIm, n, "fftBluestein: chirpIm");
    aRe[n] = sample * bRe;
    aIm[n] = sample * bIm;
  }

  // Kernel c[d] = conj(b[d]) for d = 0..N-1, wrapped so c[-d] = c[m-d].
  const kernelRe = new Float64Array(convolutionSize);
  const kernelIm = new Float64Array(convolutionSize);
  for (let d = 0; d < sampleCount; d += 1) {
    const phaseNumerator = (d * d) % (2 * sampleCount);
    const angle = (PI * phaseNumerator) / sampleCount;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    kernelRe[d] = cosine;
    kernelIm[d] = sine;
    if (d > 0) {
      kernelRe[convolutionSize - d] = cosine;
      kernelIm[convolutionSize - d] = sine;
    }
  }

  const aSpectrum = complexFft(aRe, aIm);
  const kernelSpectrum = complexFft(kernelRe, kernelIm);
  const productRe = new Float64Array(convolutionSize);
  const productIm = new Float64Array(convolutionSize);
  for (let k = 0; k < convolutionSize; k += 1) {
    const aKRe = valueAt(aSpectrum.re, k, "fftBluestein: a spectrum re");
    const aKIm = valueAt(aSpectrum.im, k, "fftBluestein: a spectrum im");
    const cKRe = valueAt(kernelSpectrum.re, k, "fftBluestein: kernel spectrum re");
    const cKIm = valueAt(kernelSpectrum.im, k, "fftBluestein: kernel spectrum im");
    productRe[k] = aKRe * cKRe - aKIm * cKIm;
    productIm[k] = aKRe * cKIm + aKIm * cKRe;
  }
  const convolution = complexIfft({ re: productRe, im: productIm });

  // X[k] = b[k] * convolution[k] for the N requested bins.
  const re = new Float64Array(sampleCount);
  const im = new Float64Array(sampleCount);
  for (let k = 0; k < sampleCount; k += 1) {
    const convRe = valueAt(convolution.re, k, "fftBluestein: convolution re");
    const convIm = valueAt(convolution.im, k, "fftBluestein: convolution im");
    const bRe = valueAt(chirpRe, k, "fftBluestein: chirpRe");
    const bIm = valueAt(chirpIm, k, "fftBluestein: chirpIm");
    re[k] = convRe * bRe - convIm * bIm;
    im[k] = convRe * bIm + convIm * bRe;
  }
  return { re, im };
}
