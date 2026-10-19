/**
 * Purpose: iterative radix-2 Cooley-Tukey fast Fourier transform and its
 * inverse. This is the production forward transform used by every
 * frequency-domain tool in @avalab/dsp; dftNaive remains the O(N^2) reference
 * it is validated against.
 *
 * Formula (SciPy convention, used everywhere in this library):
 *   Forward:  X[k] = sum_{n=0}^{N-1} x[n] * e^(-j*2*pi*k*n/N)
 *   Inverse:  x[n] = (1/N) * sum_{k=0}^{N-1} X[k] * e^(+j*2*pi*k*n/N)
 * The forward transform is unscaled and the inverse carries exactly 1/N.
 *
 * Decimation-in-time butterfly for stage length m (half = m/2, W = e^(-j2*pi/m)):
 *   for each block offset b and j = 0..half-1:
 *     a = b + j,                c = a + half
 *     t = W^j * X[c]            (complex multiply)
 *     X[c] = X[a] - t
 *     X[a] = X[a] + t
 * The input is first permuted into bit-reversed order, then log2(N) stages of
 * N/2 butterflies are applied in place. Twiddles are precomputed once per
 * transform size and indexed with stride N/m.
 *
 * Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
 * section 9.3 (radix-2 decimation-in-time FFT). SciPy's fft/ifft define the
 * golden vectors.
 *
 * Complexity: O(N log N) time, O(N) space (bit-reversal table + N/2 twiddles).
 *
 * Edge cases: N must be a power of two for this function (non-power-of-two
 * sizes -> RangeError; a Bluestein/zero-pad strategy is a separate algorithm);
 * empty input -> zero-length Complex / Float64Array; N = 1 is the identity;
 * a NaN or +/-Infinity sample or spectrum value -> TypeError; ifftRadix2
 * rejects a Complex whose re/im lengths differ. Both functions allocate fresh
 * output arrays and never mutate their inputs. ifftRadix2 returns only the
 * real part: spectra produced by this library describe real signals, whose
 * Hermitian-symmetric inverse is real up to roundoff (the golden vectors pin
 * scipy.fft.ifft(X).real); a caller that edits a spectrum without Hermitian
 * symmetry can still use the result as Re{...}. Validating Hermitian symmetry
 * belongs to the rfft/irfft contract, not here.
 */

import type { Complex } from "./complex.js";

const TAU = 2 * Math.PI;

interface FftPlan {
  readonly size: number;
  readonly bitReversed: Uint32Array;
  readonly twiddleRe: Float64Array;
  readonly twiddleIm: Float64Array;
}

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

function assertPowerOfTwo(size: number, label: string): void {
  // Bitwise test is exact for all realistic sizes (typed arrays cannot hold
  // more than 2^32 elements anyway); size 0 is handled by the callers.
  if (size <= 0 || (size & (size - 1)) !== 0) {
    throw new RangeError(`${label}: size ${size} is not a positive power of two`);
  }
}

function planFor(size: number): FftPlan {
  const bitCount = Math.log2(size);
  const bitReversed = new Uint32Array(size);
  for (let index = 0; index < size; index += 1) {
    let reversed = 0;
    for (let bit = 0; bit < bitCount; bit += 1) {
      reversed = (reversed << 1) | ((index >> bit) & 1);
    }
    bitReversed[index] = reversed;
  }

  const halfSize = size >> 1;
  const twiddleRe = new Float64Array(halfSize);
  const twiddleIm = new Float64Array(halfSize);
  for (let k = 0; k < halfSize; k += 1) {
    const angle = (-TAU * k) / size;
    twiddleRe[k] = Math.cos(angle);
    twiddleIm[k] = Math.sin(angle);
  }
  return { size, bitReversed, twiddleRe, twiddleIm };
}

/**
 * Runs the butterfly stages on data already in bit-reversed order.
 * `re`/`im` are private copies owned by the caller of this helper.
 */
function butterfliesInPlace(re: Float64Array, im: Float64Array, plan: FftPlan): void {
  const { size, twiddleRe, twiddleIm } = plan;
  for (let stageSize = 2; stageSize <= size; stageSize <<= 1) {
    const half = stageSize >> 1;
    const twiddleStride = size / stageSize;
    for (let blockStart = 0; blockStart < size; blockStart += stageSize) {
      for (let j = 0; j < half; j += 1) {
        const twiddleIndex = j * twiddleStride;
        const wRe = valueAt(twiddleRe, twiddleIndex, "fftRadix2: twiddleRe");
        const wIm = valueAt(twiddleIm, twiddleIndex, "fftRadix2: twiddleIm");
        const evenIndex = blockStart + j;
        const oddIndex = evenIndex + half;
        const oddRe = valueAt(re, oddIndex, "fftRadix2: re");
        const oddIm = valueAt(im, oddIndex, "fftRadix2: im");
        const productRe = oddRe * wRe - oddIm * wIm;
        const productIm = oddRe * wIm + oddIm * wRe;
        const evenRe = valueAt(re, evenIndex, "fftRadix2: re");
        const evenIm = valueAt(im, evenIndex, "fftRadix2: im");
        re[evenIndex] = evenRe + productRe;
        im[evenIndex] = evenIm + productIm;
        re[oddIndex] = evenRe - productRe;
        im[oddIndex] = evenIm - productIm;
      }
    }
  }
}

export function fftRadix2(samples: Float64Array): Complex {
  const size = samples.length;
  if (size === 0) {
    return { re: new Float64Array(0), im: new Float64Array(0) };
  }
  // Validate before the power-of-two check so a corrupt sample is reported as
  // a data error (TypeError), never silently reinterpreted.
  for (let index = 0; index < size; index += 1) {
    valueAt(samples, index, "fftRadix2: samples");
  }
  assertPowerOfTwo(size, "fftRadix2");

  const plan = planFor(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    const reversed = plan.bitReversed[index];
    if (reversed === undefined) {
      throw new TypeError(`fftRadix2: bitReversed[${index}] read out of bounds`);
    }
    re[reversed] = valueAt(samples, index, "fftRadix2: samples");
  }
  butterfliesInPlace(re, im, plan);
  return { re, im };
}

export function ifftRadix2(spectrum: Complex): Float64Array {
  const size = spectrum.re.length;
  if (spectrum.im.length !== size) {
    throw new TypeError(
      `ifftRadix2: re length ${size} does not match im length ${spectrum.im.length}`,
    );
  }
  if (size === 0) {
    return new Float64Array(0);
  }
  for (let index = 0; index < size; index += 1) {
    valueAt(spectrum.re, index, "ifftRadix2: re");
    valueAt(spectrum.im, index, "ifftRadix2: im");
  }
  assertPowerOfTwo(size, "ifftRadix2");

  // Conjugate trick: ifft(X) = conj(fft(conj(X))) / N. The forward butterfly
  // stages run unchanged on the conjugated spectrum, then the real part is
  // scaled by 1/N (the conjugate's real part equals the original re).
  const plan = planFor(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    const reversed = plan.bitReversed[index];
    if (reversed === undefined) {
      throw new TypeError(`ifftRadix2: bitReversed[${index}] read out of bounds`);
    }
    const reValue = valueAt(spectrum.re, index, "ifftRadix2: re");
    const imValue = valueAt(spectrum.im, index, "ifftRadix2: im");
    re[reversed] = reValue;
    im[reversed] = -imValue;
  }
  butterfliesInPlace(re, im, plan);

  const samples = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    samples[index] = valueAt(re, index, "ifftRadix2: result") / size;
  }
  return samples;
}
