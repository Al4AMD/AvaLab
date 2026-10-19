/**
 * Purpose: deterministic noise generators for F12 (signal generator) and the
 * F03/F05 teaching demos. Noise must be reproducible from a seed inside this
 * library so a waveform, spectrum, quantizer or metric stays stable when a
 * slider moves; it is deliberately not pinned to a cross-language golden
 * vector (see below).
 *
 * PRNG — mulberry32 (32-bit state):
 *   state_{k+1} = (state_k + 0x6D2B79F5) mod 2^32
 *   t = state_{k+1}
 *   t = imul(t xor (t >>> 15), t or 1)
 *   t = t xor (t + imul(t xor (t >>> 7), t or 61))
 *   u_k = ((t xor (t >>> 14)) >>> 0) / 2^32
 * `imul` is a 32-bit multiplication; every operation is integer-exact in
 * JavaScript, so a given seed produces the same sequence on every engine that
 * implements the ECMAScript bitwise operators. The seed is reduced modulo
 * 2^32, which is the pinned state width.
 *
 * White noise:
 *   x[n] = amplitude * (2 * u_n - 1),  u_n in [0, 1)
 * Hence x[n] in [-amplitude, amplitude) for positive amplitude, zero mean and
 * variance amplitude^2 / 3.
 *
 * Pink noise — Voss–McCartney algorithm with a pinned 16 octaves:
 *   - 16 independent white sources ("rows") r_p, p = 0..15.
 *   - At sample n = 0 every row is drawn independently.
 *   - For n > 0, row p is refreshed with a fresh white value exactly when
 *     2^p divides n. Row 0 therefore changes every sample, row 1 every second
 *     sample, ..., row 15 every 32768 samples.
 *   - The raw pink value is the sum of all 16 rows; summing octave-spaced
 *     zero-order-held white sources approximates a 1/f power spectral density.
 *   - The sequence is finally scaled so max |x[n]| <= |amplitude| (peak
 *     normalization with a one-ulp margin, so rounding can never exceed the
 *     bound). For the usual positive amplitude this satisfies
 *     peak <= amplitude; a negative amplitude only mirrors the waveform.
 * The exact peak normalization makes the generator output depend on the whole
 * realization, not just the current row state, so `generatePinkNoise` is not
 * streamable — documented trade-off for the simple, verifiable bound.
 *
 * Reproducibility: the same seed and the same version of this TypeScript
 * implementation produce byte-identical output. There is NO golden JSON and NO
 * guarantee of the same samples from another language, another PRNG, or a
 * future change of this file: mulberry32 is a pinned implementation detail,
 * not a portable stream format. Use the closed-form generators for goldens.
 *
 * Reference: J. McCartney, "Generating Pink Noise" (1999), describing the
 * Voss–McCartney algorithm; R. F. Voss and J. Clarke, "1/f noise in music and
 * speech", Nature 258 (1978) for the octave-source construction. mulberry32
 * is Tommy Ettinger's public-domain 32-bit generator (2017).
 *
 * Complexity: O(N) time and O(N) output space for both generators; pink noise
 * uses O(1) extra state (16 rows) because it maintains the running sum. The
 * peak-normalization pass is a second O(N) scan.
 *
 * Edge cases: sampleRateHz must be a positive finite number and
 * durationSeconds a non-negative finite number -> RangeError for finite
 * out-of-domain values, TypeError for NaN/Infinity (R6: non-finite numeric
 * parameters are type errors). The rounded sample count must be a safe
 * integer -> RangeError otherwise; duration 0 returns an empty Float64Array.
 * seed must be a finite integer -> RangeError otherwise (the explicit seed
 * contract). amplitude must be finite -> TypeError otherwise; a negative
 * amplitude is accepted and mirrors the output. No input is mutated and every
 * call returns a fresh array.
 */

import type { SignalSpec } from "./generators.js";

const UINT32_MODULUS = 4294967296;
const MULBERRY32_INCREMENT = 0x6d2b79f5;
const PINK_OCTAVE_COUNT = 16;

function assertFiniteParam(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite (got ${value})`);
  }
}

function sampleCountOf(spec: SignalSpec, caller: string): number {
  const { durationSeconds, sampleRateHz } = spec;
  assertFiniteParam(sampleRateHz, `${caller}: sampleRateHz`);
  assertFiniteParam(durationSeconds, `${caller}: durationSeconds`);
  if (sampleRateHz <= 0) {
    throw new RangeError(
      `${caller}: sampleRateHz must be a positive finite number (got ${sampleRateHz})`,
    );
  }
  if (durationSeconds < 0) {
    throw new RangeError(
      `${caller}: durationSeconds must be a non-negative finite number (got ${durationSeconds})`,
    );
  }
  const sampleCount = Math.round(durationSeconds * sampleRateHz);
  if (!Number.isSafeInteger(sampleCount)) {
    throw new RangeError(
      `${caller}: durationSeconds * sampleRateHz must be a safe integer sample count (got ${sampleCount})`,
    );
  }
  return sampleCount;
}

function assertAmplitude(amplitude: number, caller: string): void {
  assertFiniteParam(amplitude, `${caller}: amplitude`);
}

/**
 * mulberry32: returns a function that yields successive values in [0, 1).
 * The seed is a finite integer, reduced modulo 2^32; a non-integer or
 * non-finite seed throws RangeError (the seed contract is stricter than the
 * generic numeric-parameter rule).
 */
export function mulberry32(seed: number): () => number {
  if (!Number.isFinite(seed) || !Number.isInteger(seed)) {
    throw new RangeError(`mulberry32: seed must be a finite integer (got ${seed})`);
  }
  let state = seed >>> 0;
  return (): number => {
    state = (state + MULBERRY32_INCREMENT) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_MODULUS;
  };
}

/**
 * White noise: x[n] = amplitude * (2*u[n] - 1), u[n] in [0, 1).
 * Same seed -> identical array; different seeds almost surely differ.
 */
export function generateWhiteNoise(
  spec: SignalSpec & { seed: number; amplitude: number },
): Float64Array {
  const sampleCount = sampleCountOf(spec, "generateWhiteNoise");
  assertAmplitude(spec.amplitude, "generateWhiteNoise");
  const random = mulberry32(spec.seed);

  const values = new Float64Array(sampleCount);
  for (let n = 0; n < sampleCount; n += 1) {
    values[n] = spec.amplitude * (2 * random() - 1);
  }
  return values;
}

/**
 * Pink noise (Voss–McCartney, 16 octaves), peak-normalized to |amplitude|.
 * See the module header for the update schedule and the lack of
 * cross-language reproducibility.
 */
export function generatePinkNoise(
  spec: SignalSpec & { seed: number; amplitude: number },
): Float64Array {
  const sampleCount = sampleCountOf(spec, "generatePinkNoise");
  assertAmplitude(spec.amplitude, "generatePinkNoise");
  const random = mulberry32(spec.seed);

  const values = new Float64Array(sampleCount);
  if (sampleCount === 0) {
    return values;
  }

  // Initialize every row at n = 0 so the octave sources do not start with a
  // long silent transient; later rows refresh only on their own schedule.
  const rows = new Float64Array(PINK_OCTAVE_COUNT);
  let runningSum = 0;
  for (let row = 0; row < PINK_OCTAVE_COUNT; row += 1) {
    const value = 2 * random() - 1;
    rows[row] = value;
    runningSum += value;
  }
  values[0] = runningSum;

  for (let n = 1; n < sampleCount; n += 1) {
    // Row p refreshes when 2^p divides n; n has tz trailing zero bits, so
    // rows 0..tz refresh at this sample. Stop at the pinned octave count.
    let trailingZeros = 0;
    let remaining = n;
    while (trailingZeros < PINK_OCTAVE_COUNT && remaining % 2 === 0) {
      trailingZeros += 1;
      remaining = Math.floor(remaining / 2);
    }
    const refreshCount = Math.min(trailingZeros + 1, PINK_OCTAVE_COUNT);
    for (let row = 0; row < refreshCount; row += 1) {
      runningSum -= rows[row] ?? 0;
      const value = 2 * random() - 1;
      rows[row] = value;
      runningSum += value;
    }
    values[n] = runningSum;
  }

  let peak = 0;
  for (let n = 0; n < sampleCount; n += 1) {
    const magnitude = Math.abs(values[n] ?? 0);
    if (magnitude > peak) {
      peak = magnitude;
    }
  }
  if (peak > 0) {
    // The (1 - eps) factor keeps max |x[n]| strictly inside the bound even if
    // the final multiply rounds upward by one ulp.
    const scale = (spec.amplitude / peak) * (1 - Number.EPSILON);
    for (let n = 0; n < sampleCount; n += 1) {
      values[n] = (values[n] ?? 0) * scale;
    }
  }
  return values;
}
