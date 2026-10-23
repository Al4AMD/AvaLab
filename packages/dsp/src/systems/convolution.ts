/**
 * Purpose: direct linear convolution of two finite sequences, the LTI backbone
 * of the F10 reverb lab and of the FIR filtering path. This is the slow,
 * obviously-correct reference: every output sample is an explicit
 * multiply-accumulate over the overlapping support. Fast FFT overlap-add
 * convolution (plan 03 task 2) is checked against this function.
 *
 * Formula (linear convolution sum):
 *   y[n] = Σ_{k=0}^{M-1} h[k] · x[n-k],  n = 0 .. N+M-2,
 * where x[n] = 0 outside [0, N-1] and h[n] = 0 outside [0, M-1].
 * The result therefore has length N + M - 1. Direct summation is asymmetric
 * in the two inputs by construction; the convolution is commutative, which
 * the tests pin numerically at ≤ 1e-12.
 *
 * Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
 * §2.3 (convolution sum of LTI systems); NumPy `np.convolve` defines the
 * golden vectors in test-data/golden/convolution_direct.json.
 *
 * Complexity: O(N·M) time and O(N+M-1) output space (the teaching-relevant
 * cost that motivates the FFT path). Float64 accumulation; inputs are never
 * mutated and every call returns a fresh Float64Array.
 *
 * Edge cases (controller ruling R11): either input empty → RangeError (the
 * convolution length would be ill-defined); any NaN or ±Infinity sample in
 * either input → TypeError. N = 1 or M = 1 are valid and reduce to
 * scalar multiplication / the identity kernel.
 */

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
