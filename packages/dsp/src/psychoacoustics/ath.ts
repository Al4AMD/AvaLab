/**
 * Purpose: F13 absolute threshold of hearing (ATH) in dB SPL.
 *
 * Formula (Terhardt):
 *   Tq(f) = 3.64 (f/1000)^−0.8
 *           − 6.5 exp(−0.6 (f/1000 − 3.3)^2)
 *           + 1e-3 (f/1000)^4
 * with f clamped to >= 20 Hz. The formula is evaluated through Nyquist; the
 * model does not add an upper clamp because band centers are already inside
 * the Nyquist limit.
 *
 * Reference: Terhardt, "Calculating virtual pitch", Hearing Research 1, 1979.
 *
 * Complexity: O(1) per point, O(bandCount) for band thresholds.
 *
 * Edge cases: non-finite frequency → RangeError. Values below 20 Hz use the
 * 20 Hz threshold. A band with zero width uses its center (0 Hz clamps to 20).
 */

const LOWEST_FREQUENCY_HZ = 20;

/** Terhardt ATH in dB SPL for one frequency. */
export function absoluteThresholdDb(frequencyHz: number): number {
  if (!Number.isFinite(frequencyHz) || frequencyHz < 0) {
    throw new RangeError(
      `absoluteThresholdDb: frequencyHz must be finite and >= 0 (got ${frequencyHz})`,
    );
  }
  const kilo = Math.max(LOWEST_FREQUENCY_HZ, frequencyHz) / 1000;
  return 3.64 * kilo ** -0.8 - 6.5 * Math.exp(-0.6 * (kilo - 3.3) ** 2) + 1e-3 * kilo ** 4;
}

/**
 * ATH per band using the geometric-mean center sqrt(fLow·fHigh). Empty
 * bands carry the center threshold; the caller decides whether to use it.
 */
export function bandAthDb(edgesHz: Float64Array): Float64Array {
  if (edgesHz.length < 2) {
    throw new RangeError(`bandAthDb: edgesHz must hold at least two edges (got ${edgesHz.length})`);
  }
  const bandCount = edgesHz.length - 1;
  const thresholds = new Float64Array(bandCount);
  for (let band = 0; band < bandCount; band += 1) {
    const low = edgesHz[band];
    const high = edgesHz[band + 1];
    if (
      low === undefined ||
      high === undefined ||
      !Number.isFinite(low) ||
      !Number.isFinite(high) ||
      low < 0 ||
      high < low
    ) {
      throw new RangeError(`bandAthDb: invalid edge pair at band ${band}`);
    }
    thresholds[band] = absoluteThresholdDb(Math.sqrt(low * high));
  }
  return thresholds;
}
