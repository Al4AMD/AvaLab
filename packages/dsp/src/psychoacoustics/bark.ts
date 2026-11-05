/**
 * Purpose: F13 Bark-scale conversions and critical-band edges used by the
 * masking model and the psychoacoustics explorer.
 *
 * Formula (Zwicker–Terhardt):
 *   z(f) = 13 atan(0.00076 f) + 3.5 atan((f / 7500)^2)   [Bark]
 * Bands are equal Bark intervals z = i·25/bandCount, converted back to Hz by
 * deterministic bisection and clamped to [0, Nyquist].
 *
 * Reference: Zwicker & Terhardt, "Analytical expressions for critical-band
 * rate and its implementation", JASA 68(5), 1980.
 *
 * Complexity: O(iterations) per conversion; O(bandCount·iterations) for edges.
 *
 * Edge cases: hz must be finite and >= 0; sampleRateHz must be finite and > 0;
 * bandCount must be an integer >= 1. barkToHz clamps z to [0, 25] and the
 * result to [0, Nyquist]. Invalid inputs throw typed RangeError.
 */

const MAX_BARK = 25;
const BISECTION_ITERATIONS = 80;

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`hzToBark: ${name} must be finite and >= 0 (got ${value})`);
  }
}

/** Convert a frequency in Hz to the Bark critical-band rate. */
export function hzToBark(hz: number): number {
  assertFiniteNonNegative(hz, "hz");
  return 13 * Math.atan(0.00076 * hz) + 3.5 * Math.atan((hz / 7500) ** 2);
}

/**
 * Convert Bark to Hz by deterministic bisection on [0, Nyquist]. `bark` is
 * clamped to [0, 25]; values above the Bark rate of Nyquist return Nyquist.
 */
export function barkToHz(bark: number, sampleRateHz: number): number {
  if (!Number.isFinite(bark)) {
    throw new RangeError(`barkToHz: bark must be finite (got ${bark})`);
  }
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError(`barkToHz: sampleRateHz must be finite and > 0 (got ${sampleRateHz})`);
  }
  const nyquistHz = 0.5 * sampleRateHz;
  const clamped = Math.min(MAX_BARK, Math.max(0, bark));
  if (clamped <= 0) {
    return 0;
  }
  if (hzToBark(nyquistHz) <= clamped) {
    return nyquistHz;
  }
  let low = 0;
  let high = nyquistHz;
  for (let iteration = 0; iteration < BISECTION_ITERATIONS; iteration += 1) {
    const middle = 0.5 * (low + high);
    if (hzToBark(middle) < clamped) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return 0.5 * (low + high);
}

/**
 * Return bandCount + 1 edges in Hz at equal Bark intervals over [0, 25],
 * clamped to Nyquist. Empty bands are expected when Nyquist is below the top
 * Bark edge.
 */
export function barkBandEdgesHz(sampleRateHz: number, bandCount = 25): Float64Array {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError(
      `barkBandEdgesHz: sampleRateHz must be finite and > 0 (got ${sampleRateHz})`,
    );
  }
  if (!Number.isInteger(bandCount) || bandCount < 1) {
    throw new RangeError(`barkBandEdgesHz: bandCount must be an integer >= 1 (got ${bandCount})`);
  }
  const edges = new Float64Array(bandCount + 1);
  for (let index = 0; index <= bandCount; index += 1) {
    edges[index] = barkToHz((index * MAX_BARK) / bandCount, sampleRateHz);
  }
  return edges;
}

/**
 * Bark band index (0..24) for a frequency. Frequencies above 25 Bark clamp to
 * the last band. This assumes the default 25-band grid.
 */
export function barkBandIndexOf(hz: number): number {
  assertFiniteNonNegative(hz, "hz");
  return Math.min(24, Math.max(0, Math.floor(hzToBark(hz))));
}
