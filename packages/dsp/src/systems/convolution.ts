/**
 * Purpose: linear convolution of two finite sequences, the LTI backbone of the
 * F10 reverb lab and of the FIR filtering path. `convolveDirect` is the slow,
 * obviously-correct reference: every output sample is an explicit
 * multiply-accumulate over the overlapping support. `convolveFft` is the
 * production path: it splits the signal into blocks, convolves each block with
 * the kernel in the frequency domain, and overlap-adds the block results
 * (Oppenheim & Schafer §9.4). The direct result is the reference the fast path
 * is property-tested against.
 *
 * Formula (linear convolution sum):
 *   y[n] = Σ_{k=0}^{M-1} h[k] · x[n-k],  n = 0 .. N+M-2,
 * where x[n] = 0 outside [0, N-1] and h[n] = 0 outside [0, M-1].
 * The result therefore has length N + M - 1. Direct summation is asymmetric
 * in the two inputs by construction; the convolution is commutative, which
 * the tests pin numerically at ≤ 1e-12.
 *
 * Overlap-add (block length B, FFT length L):
 *   x_b[m] = x[bB + m],  m = 0 .. B-1, zero outside the block,
 *   Y_b[k] = FFT_L{x_b}[k] · FFT_L{h}[k],  y_b[n] = IFFT_L{Y_b}[n],
 *   y[n]   = Σ_b y_b[n - bB].
 * Choosing L ≥ B + M - 1 keeps every block product equal to the LINEAR
 * convolution of that block with h (no circular wrap), and the block results
 * add in the overlap region. The default B = nextPowerOfTwo(M) and
 * L = nextPowerOfTwo(B + M - 1) mirror the usual textbook choice; the caller
 * may pin a smaller block with `blockLengthSamples`. The last block may be
 * shorter than B, but `y_b` still has `blockSamples + M - 1` nonzero samples, so the final
 * M - 1 output samples are written exactly once (controller ruling R12 and
 * Review Focus 1: the classic dropped-tail bug).
 *
 * Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
 * §2.3 (convolution sum of LTI systems) and §9.4 (overlap-add); NumPy
 * `np.convolve` defines the golden vectors for `convolveDirect` in
 * test-data/golden/convolution_direct.json.
 *
 * Complexity: direct — O(N·M) time, O(N+M-1) space. FFT overlap-add — one
 * kernel transform plus O(⌈N/B⌉) forward/inverse transforms of length
 * L = O(B + M), i.e. O((N/B)·L·log L) time and O(L + N + M) space; with the
 * default B ≈ M this is O(N·log M) for long signals. Float64 accumulation;
 * inputs are never mutated and every call returns a fresh Float64Array.
 *
 * Edge cases (controller rulings R11-R13): either input empty → RangeError
 * (the convolution length would be ill-defined); any NaN or ±Infinity sample
 * in either input → TypeError; `blockLengthSamples` must be an integer ≥ 1 →
 * else RangeError. N = 1 or M = 1 are valid and reduce to scalar
 * multiplication / the identity kernel. `nextPowerOfTwo(1) = 1` is legal, so
 * even a one-sample block and a one-tap kernel stay exact.
 */

import { fft, ifft } from "../fourier/transform.js";
import type { FloatArray } from "../signals/extent.js";

function assertFiniteSamples(samples: FloatArray, label: string): void {
  for (let n = 0; n < samples.length; n += 1) {
    const sample: number | undefined = samples[n];
    if (sample === undefined) {
      throw new TypeError(`${label}: samples[${n}] read out of bounds`);
    }
    if (!Number.isFinite(sample)) {
      throw new TypeError(`${label}: samples[${n}] must be finite (got ${sample})`);
    }
  }
}

/**
 * Smallest power of two ≥ n (controller ruling R13). n ≤ 1 returns 1, which
 * lets one-sample blocks and one-tap kernels use a length-1 transform. Any
 * finite n > 1 must be a positive integer; NaN, ±Infinity and fractions > 1
 * are rejected because they cannot describe a transform size.
 *
 * @throws RangeError when n > 1 is not a finite integer.
 */
export function nextPowerOfTwo(n: number): number {
  if (!Number.isFinite(n)) {
    throw new RangeError(`nextPowerOfTwo: n must be finite (got ${n})`);
  }
  if (n <= 1) {
    return 1;
  }
  if (!Number.isInteger(n)) {
    throw new RangeError(`nextPowerOfTwo: n must be an integer (got ${n})`);
  }
  let size = 1;
  while (size < n) {
    size *= 2;
  }
  if (!Number.isSafeInteger(size)) {
    throw new RangeError(`nextPowerOfTwo: n is too large (got ${n})`);
  }
  return size;
}

export interface ConvolveFftOptions {
  /** Block length B in samples; defaults to nextPowerOfTwo(max(M, 1)). */
  readonly blockLengthSamples?: number;
}

function resolveBlockLength(blockLengthSamples: number | undefined, kernelLength: number): number {
  if (blockLengthSamples === undefined) {
    return nextPowerOfTwo(Math.max(kernelLength, 1));
  }
  if (!Number.isInteger(blockLengthSamples) || blockLengthSamples < 1) {
    throw new RangeError(
      `convolveFft: blockLengthSamples must be an integer >= 1 (got ${blockLengthSamples})`,
    );
  }
  return blockLengthSamples;
}

/**
 * Direct linear convolution: y = x * h, length x.length + h.length - 1.
 *
 * @throws RangeError when either input is empty.
 * @throws TypeError when any sample is NaN or ±Infinity.
 */
export function convolveDirect(x: Float64Array, h: Float64Array): Float64Array {
  if (x.length === 0) {
    throw new RangeError("convolveDirect: x must be non-empty");
  }
  if (h.length === 0) {
    throw new RangeError("convolveDirect: h must be non-empty");
  }
  assertFiniteSamples(x, "convolveDirect: x");
  assertFiniteSamples(h, "convolveDirect: h");

  const signalLength = x.length;
  const kernelLength = h.length;
  const outputLength = signalLength + kernelLength - 1;
  const output = new Float64Array(outputLength);

  // y[n] = sum over the kernel taps that overlap the signal. Bounds are the
  // intersection of x's support [0, N-1] and the shifted kernel support
  // [n-M+1, n], which keeps every inner-loop access in range and skips the
  // implicit zero padding at both ends.
  for (let n = 0; n < outputLength; n += 1) {
    const firstSignalIndex = Math.max(0, n - kernelLength + 1);
    const lastSignalIndex = Math.min(n, signalLength - 1);
    let accumulator = 0;
    for (let k = firstSignalIndex; k <= lastSignalIndex; k += 1) {
      accumulator += (x[k] ?? 0) * (h[n - k] ?? 0);
    }
    output[n] = accumulator;
  }

  return output;
}

/**
 * FFT overlap-add linear convolution: y = x * h, length exactly
 * x.length + h.length - 1. Equivalent to `convolveDirect` up to Float64
 * roundoff; the result is assembled block by block, including the final
 * partial block and its M - 1 sample tail.
 *
 * @param x Signal samples (N ≥ 1). Never mutated.
 * @param h Kernel/impulse-response samples (M ≥ 1). Never mutated.
 * @param options `blockLengthSamples` overrides the default block
 *   nextPowerOfTwo(max(M, 1)); the FFT size is always
 *   nextPowerOfTwo(block + M - 1).
 * @throws RangeError when either input is empty or the block length is not an
 *   integer ≥ 1.
 * @throws TypeError when any sample is NaN or ±Infinity.
 */
export function convolveFft(
  x: Float64Array,
  h: Float64Array,
  options: ConvolveFftOptions = {},
): Float64Array {
  if (x.length === 0) {
    throw new RangeError("convolveFft: x must be non-empty");
  }
  if (h.length === 0) {
    throw new RangeError("convolveFft: h must be non-empty");
  }
  assertFiniteSamples(x, "convolveFft: x");
  assertFiniteSamples(h, "convolveFft: h");

  const signalLength = x.length;
  const kernelLength = h.length;
  const blockLength = resolveBlockLength(options.blockLengthSamples, kernelLength);
  const fftLength = nextPowerOfTwo(blockLength + kernelLength - 1);
  const outputLength = signalLength + kernelLength - 1;
  const output = new Float64Array(outputLength);

  // The kernel is the same for every block, so transform it once. Zero-padding
  // to fftLength turns the circular product below into the linear convolution
  // of each block with h.
  const paddedKernel = new Float64Array(fftLength);
  paddedKernel.set(h);
  const kernelSpectrum = fft(paddedKernel);

  const productRe = new Float64Array(fftLength);
  const productIm = new Float64Array(fftLength);

  for (let blockStart = 0; blockStart < signalLength; blockStart += blockLength) {
    const blockSamples = Math.min(blockLength, signalLength - blockStart);
    const paddedBlock = new Float64Array(fftLength);
    paddedBlock.set(x.subarray(blockStart, blockStart + blockSamples));
    const blockSpectrum = fft(paddedBlock);

    for (let k = 0; k < fftLength; k += 1) {
      const blockRe = blockSpectrum.re[k] ?? 0;
      const blockIm = blockSpectrum.im[k] ?? 0;
      const kernelRe = kernelSpectrum.re[k] ?? 0;
      const kernelIm = kernelSpectrum.im[k] ?? 0;
      productRe[k] = blockRe * kernelRe - blockIm * kernelIm;
      productIm[k] = blockRe * kernelIm + blockIm * kernelRe;
    }

    const blockResult = ifft({ re: productRe, im: productIm });

    // Only the first blockSamples + M - 1 samples of the block convolution are
    // nonzero. Clamping to outputLength lets the final block write its whole
    // M - 1 sample tail and nothing past y[N + M - 2].
    const contributionLength = Math.min(blockSamples + kernelLength - 1, outputLength - blockStart);
    for (let n = 0; n < contributionLength; n += 1) {
      output[blockStart + n] = (output[blockStart + n] ?? 0) + (blockResult[n] ?? 0);
    }
  }

  return output;
}
