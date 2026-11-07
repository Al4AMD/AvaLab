/**
 * Purpose: F13 simultaneous-masking model over Bark bands: band levels,
 * Schroeder spreading, masking threshold and signal-to-mask ratio.
 *
 * Formulas:
 *   S(dz) = 15.81 + 7.5 (|dz| + 0.474)
 *           − 17.5 sqrt(1 + (|dz| + 0.474)^2)                 [dB]
 *   L_i   = refSplDb + 10 log10(sum_{k in band i} C_k^2 / P_ref)
 *   T_i   = max(ATH_i, 10 log10(sum_j 10^((L_j + S(z_i − z_j)) / 10)))
 *   SMR_i = L_i − T_i
 *   sMask_i = sqrt(12 · P_ref · 10^((T_i − refSplDb)/10) / n_i)
 *
 * The spreading expression is evaluated at |Δz|: the plan pins symmetry, and
 * the raw signed expression grows without bound for distant low-frequency
 * maskers, which is not useful in a teaching model. This is still a
 * stationary, per-frame approximation with no temporal masking and no
 * tonal/noise distinction.
 *
 * References: Schroeder, "Models of Hearing", Proc. IEEE 63(9), 1975;
 * Zwicker & Fastl, *Psychoacoustics*, 3rd ed., 2013 (critical bands, SMR).
 *
 * Complexity: O(bands² + bins) per frame; O(bands) memory beyond outputs.
 *
 * Edge cases: non-finite bins/params → TypeError/RangeError; empty bands have
 * binCount 0, level −Infinity, and maskStepForBand returns Infinity so the
 * codec can fall back to the global rate step. Silence yields −Infinity
 * levels and finite thresholds (ATH), never NaN.
 */

const BAND_COUNT = 25;

/** Schroeder spreading value in dB for a Bark distance. Symmetric by |Δz|. */
export function spreadingDb(deltaBark: number): number {
  if (!Number.isFinite(deltaBark)) {
    throw new RangeError(`spreadingDb: deltaBark must be finite (got ${deltaBark})`);
  }
  const distance = Math.abs(deltaBark);
  return 15.81 + 7.5 * (distance + 0.474) - 17.5 * Math.sqrt(1 + (distance + 0.474) ** 2);
}

function assertEdges(edgesHz: Float64Array): void {
  if (!(edgesHz instanceof Float64Array) || edgesHz.length < 2) {
    throw new RangeError("masking: edgesHz must be a Float64Array with at least two edges");
  }
  for (let index = 0; index < edgesHz.length; index += 1) {
    const edge = edgesHz[index];
    const previous = index === 0 ? 0 : edgesHz[index - 1];
    if (
      edge === undefined ||
      previous === undefined ||
      !Number.isFinite(edge) ||
      !Number.isFinite(previous) ||
      edge < 0 ||
      edge < previous
    ) {
      throw new RangeError(`masking: invalid edge at index ${index}`);
    }
  }
}

/**
 * Per-band coefficient energy converted to dB SPL. The optional sample rate
 * maps MDCT bin centers to Hz; without it the last edge is assumed to be
 * Nyquist (true for the default 25-band 8/48 kHz grids).
 */
export function bandLevelsDb(
  coefficients: Float64Array,
  edgesHz: Float64Array,
  refSplDb: number,
  referencePower: number,
  sampleRateHz?: number,
): { levelsDb: Float64Array; binCounts: Int32Array } {
  assertEdges(edgesHz);
  if (!(coefficients instanceof Float64Array)) {
    throw new TypeError("bandLevelsDb: coefficients must be a Float64Array");
  }
  if (!Number.isFinite(refSplDb)) {
    throw new RangeError(`bandLevelsDb: refSplDb must be finite (got ${refSplDb})`);
  }
  if (!Number.isFinite(referencePower) || referencePower <= 0) {
    throw new RangeError(
      `bandLevelsDb: referencePower must be finite and > 0 (got ${referencePower})`,
    );
  }
  const bandCount = edgesHz.length - 1;
  const binCount = coefficients.length;
  const levelsDb = new Float64Array(bandCount);
  const binCounts = new Int32Array(bandCount);
  const powers = new Float64Array(bandCount);
  levelsDb.fill(Number.NEGATIVE_INFINITY);
  if (binCount === 0) {
    return { levelsDb, binCounts };
  }
  const lastEdge = edgesHz[bandCount];
  if (lastEdge === undefined) {
    throw new RangeError("bandLevelsDb: missing last edge");
  }
  const rateHz = sampleRateHz ?? 2 * lastEdge;
  if (!Number.isFinite(rateHz) || rateHz <= 0) {
    throw new RangeError(`bandLevelsDb: sampleRateHz must be finite and > 0 (got ${rateHz})`);
  }

  for (let bin = 0; bin < binCount; bin += 1) {
    const coefficient = coefficients[bin];
    if (coefficient === undefined || !Number.isFinite(coefficient)) {
      throw new TypeError(`bandLevelsDb: coefficients[${bin}] is not finite`);
    }
    const centerHz = ((bin + 0.5) * rateHz) / (2 * binCount);
    let band = 0;
    while (band < bandCount - 1 && centerHz >= (edgesHz[band + 1] ?? Number.POSITIVE_INFINITY)) {
      band += 1;
    }
    binCounts[band] = (binCounts[band] ?? 0) + 1;
    powers[band] = (powers[band] ?? 0) + coefficient * coefficient;
  }
  for (let band = 0; band < bandCount; band += 1) {
    const power = powers[band] ?? 0;
    levelsDb[band] =
      power > 0 ? refSplDb + 10 * Math.log10(power / referencePower) : Number.NEGATIVE_INFINITY;
  }
  return { levelsDb, binCounts };
}

function assertBandVectors(
  first: Float64Array,
  second: Float64Array,
  third: Float64Array | null,
  label: string,
): number {
  if (!(first instanceof Float64Array) || !(second instanceof Float64Array)) {
    throw new TypeError(`${label}: band vectors must be Float64Arrays`);
  }
  if (third !== null && !(third instanceof Float64Array)) {
    throw new TypeError(`${label}: band vectors must be Float64Arrays`);
  }
  if (second.length !== first.length || (third !== null && third.length !== first.length)) {
    throw new RangeError(`${label}: band vectors must have equal length`);
  }
  return first.length;
}

/**
 * Masking threshold per band: the maximum of the ATH and the spread masker
 * energy. `levelsDb` may contain −Infinity for empty bands.
 */
export function maskingThresholdDb(
  levelsDb: Float64Array,
  bandCentersBark: Float64Array,
  athDb: Float64Array,
): Float64Array {
  const bandCount = assertBandVectors(levelsDb, bandCentersBark, athDb, "maskingThresholdDb");
  const thresholdsDb = new Float64Array(bandCount);
  for (let band = 0; band < bandCount; band += 1) {
    const center = bandCentersBark[band];
    const ath = athDb[band];
    if (
      center === undefined ||
      !Number.isFinite(center) ||
      ath === undefined ||
      !Number.isFinite(ath)
    ) {
      throw new RangeError(`maskingThresholdDb: invalid band ${band}`);
    }
    let maskerPower = 0;
    for (let masker = 0; masker < bandCount; masker += 1) {
      const level = levelsDb[masker];
      const maskerCenter = bandCentersBark[masker];
      if (level === undefined || maskerCenter === undefined || level === Number.NEGATIVE_INFINITY) {
        continue;
      }
      if (!Number.isFinite(level) || !Number.isFinite(maskerCenter)) {
        throw new RangeError(`maskingThresholdDb: invalid masker ${masker}`);
      }
      maskerPower += 10 ** ((level + spreadingDb(center - maskerCenter)) / 10);
    }
    const spreadThresholdDb =
      maskerPower > 0 ? 10 * Math.log10(maskerPower) : Number.NEGATIVE_INFINITY;
    thresholdsDb[band] = Math.max(ath, spreadThresholdDb);
  }
  return thresholdsDb;
}

/** SMR_i = L_i − T_i; −Infinity for an empty band. */
export function signalToMaskRatioDb(
  levelsDb: Float64Array,
  thresholdsDb: Float64Array,
): Float64Array {
  const bandCount = assertBandVectors(levelsDb, thresholdsDb, null, "signalToMaskRatioDb");
  const smrDb = new Float64Array(bandCount);
  for (let band = 0; band < bandCount; band += 1) {
    const level = levelsDb[band];
    const threshold = thresholdsDb[band];
    if (level === undefined || threshold === undefined) {
      throw new RangeError(`signalToMaskRatioDb: missing band ${band}`);
    }
    smrDb[band] = level - threshold;
  }
  return smrDb;
}

/**
 * Mask-limited quantizer step for one band. `Infinity` for an empty band
 * (the codec substitutes the global step). A −Infinity threshold yields 0,
 * which the codec's max() also replaces with the global step.
 */
export function maskStepForBand(
  thresholdDb: number,
  refSplDb: number,
  referencePower: number,
  binCount: number,
): number {
  if (!Number.isInteger(binCount) || binCount < 0) {
    throw new RangeError(`maskStepForBand: binCount must be an integer >= 0 (got ${binCount})`);
  }
  if (binCount === 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (!Number.isFinite(refSplDb)) {
    throw new RangeError(`maskStepForBand: refSplDb must be finite (got ${refSplDb})`);
  }
  if (!Number.isFinite(referencePower) || referencePower <= 0) {
    throw new RangeError(
      `maskStepForBand: referencePower must be finite and > 0 (got ${referencePower})`,
    );
  }
  if (thresholdDb === Number.NEGATIVE_INFINITY) {
    return 0;
  }
  if (!Number.isFinite(thresholdDb)) {
    throw new RangeError(
      `maskStepForBand: thresholdDb must be finite or -Infinity (got ${thresholdDb})`,
    );
  }
  const thresholdPower = referencePower * 10 ** ((thresholdDb - refSplDb) / 10);
  return Math.sqrt((12 * thresholdPower) / binCount);
}

/** Number of Bark bands used by the model (kept in sync with bark.ts). */
export const PSYCHO_BAND_COUNT = BAND_COUNT;
