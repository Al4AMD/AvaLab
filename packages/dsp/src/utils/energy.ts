/**
 * Purpose: energy of a discrete-time signal. Core quantity of the F07
 * "signal extent in time" lab (energy vs average power classification).
 *
 * Formula: E = sum_{n=0}^{N-1} x[n]^2
 * Parseval companion (used to cross-check spectra in later waves):
 *   E = (1/N) * sum_{k=0}^{N-1} |X[k]|^2
 *
 * Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
 * section 2.1 (energy and average power of discrete-time signals).
 *
 * Complexity: O(N) time, O(1) extra space.
 *
 * Edge cases: empty input -> 0; a NaN or +/-Infinity sample -> TypeError
 * (rejected explicitly rather than silently poisoning the sum); accumulation
 * is always Float64 even when the input is Float32.
 */

export function energyOf(samples: Float64Array | Float32Array): number {
  let energy = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample: number | undefined = samples[i];
    if (sample === undefined) {
      throw new TypeError(`energyOf: samples[${i}] read out of bounds`);
    }
    if (!Number.isFinite(sample)) {
      throw new TypeError(`energyOf: samples[${i}] is not finite (${sample})`);
    }
    energy += sample * sample;
  }
  return energy;
}

/**
 * Purpose: average power of a discrete-time signal (energy per sample), the
 * divisor that distinguishes energy signals from power signals in F07.
 *
 * Formula: P = E / N with E = sum_{n=0}^{N-1} x[n]^2 and N = samples.length.
 *
 * Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
 * section 2.1 (average power of discrete-time signals).
 *
 * Complexity: O(N) time, O(1) extra space.
 *
 * Edge cases: N = 0 -> 0 by documented convention (the power of an empty
 * signal is defined as 0, not NaN); otherwise delegates to energyOf, so NaN
 * or infinite samples throw TypeError.
 */

export function averagePowerOf(samples: Float64Array | Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }
  return energyOf(samples) / samples.length;
}
