/**
 * Purpose: min/max peak buckets for the waveform overview display (F02): the
 * honest per-bucket envelope — every bucket's exact minimum and maximum —
 * drawn later as a filled band (Plan 03). Exact per-bucket extrema (rather
 * than subsampled maxima) mean a transient shorter than one bucket still
 * shows its true peak, which is the display property a waveform thumbnail
 * must have. The op wrapper lives in apps/web `session/ops.ts`
 * (`waveformOverview`); this module is the pure DSP math.
 *
 * Formula: linear (overlap-free, contiguous) partition of the sample range —
 * bucket b covers the half-open sample range
 *   [ floor(b·N/B), floor((b+1)·N/B) )
 * with N = x.length and B = bucketCount. Consecutive buckets chain
 * end-to-start (bucket b+1 begins exactly where bucket b ends), the union
 * over b = 0..B−1 is exactly [0, N), so every sample is counted EXACTLY once
 * — no overlap, no gap — which is what makes each extremum honest. Output:
 * interleaved Float32Array of length 2B, `out[2b]` = min of bucket b over
 * FINITE samples, `out[2b+1]` = max of bucket b over finite samples.
 *
 * Reference: conventional digital-audio-workstation overview envelope
 * (min/max "peak file" display convention, e.g. Audacity's block summary
 * files); the linear partition is the standard uniform histogram binning of
 * a finite interval. No canonical textbook theorem exists for display
 * bucketing — the overlap-free exactness above is the pinned contract here
 * and in the tests.
 *
 * Complexity: O(N + B) time — one pass over samples with an amortized-O(1)
 * bucket pointer; the while-guard reevaluates floor((b+1)·N/B) once per
 * sample and once per bucket advance, so the boundary work is O(N + B)
 * (up to one floor per sample plus one per-bucket tick), not "at most 2·B".
 * O(B) space for the output. No allocation per sample.
 *
 * Edge cases:
 * - `bucketCount` must be a positive integer (B ≥ 1); 0, negatives,
 *   non-integers, NaN and ±Infinity → `RangeError`.
 * - empty input → a length-0 Float32Array (no buckets exist without
 *   samples), regardless of a valid bucketCount.
 * - B = N (equal counts): bucket boundaries are the exact integers
 *   floor(b·N/B) = b, so bucket b holds exactly sample b and
 *   min[k] = max[k] = x[k] — the output is the input's per-sample
 *   duplicate (tested as the "equal counts" property).
 * - B > N: the partition still covers [0, N) exactly, so exactly N buckets
 *   are non-empty (one or more samples each, the per-sample-duplicate
 *   flavour documented for display use) and B − N buckets see no samples →
 *   documented 0,0 sentinel. (Display callers size B ≤ sample count.)
 * - non-finite samples (NaN/±Infinity): IGNORED per the display-envelope
 *   contract — min/max are taken over the finite values only, so a glitch
 *   sample cannot blank a whole bucket's band; a bucket with no finite
 *   values at all (empty or all-non-finite) is written as the documented
 *   0,0 sentinel (indistinguishable from a genuine [0, 0] band, which is
 *   acceptable for a display readout and documented here).
 * - no input mutation: x is only read; the returned Float32Array is fresh.
 * - boundary arithmetic `floor(k·N/B)` is integer-exact in doubles while
 *   `B·N < 2^53` (audio: N ≤ 2^31 and a display histogram width B ≤ ~10^4
 *   keeps the product far below the limit; typed-array allocation fails
 *   long before for absurd B).
 */

export function computePeakBuckets(
  x: Float32Array,
  bucketCount: number,
): Float32Array<ArrayBuffer> {
  if (!Number.isInteger(bucketCount) || bucketCount < 1) {
    throw new RangeError(
      `computePeakBuckets: bucketCount must be a positive integer, got ${String(bucketCount)}`,
    );
  }
  if (x.length === 0) {
    return new Float32Array(0);
  }
  const minMax = new Float32Array(2 * bucketCount);
  // Sentinel pass: ±Infinity marks "no finite sample seen yet"; the final
  // pass converts every untouched (or all-non-finite-bucket) entry to the
  // documented 0,0 sentinel — the sentinel stays out of real extrema because
  // finite samples always overwrite it before that pass.
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    minMax[2 * bucket] = Number.POSITIVE_INFINITY;
    minMax[2 * bucket + 1] = Number.NEGATIVE_INFINITY;
  }
  let bucket = 0;
  for (let sampleIndex = 0; sampleIndex < x.length; sampleIndex += 1) {
    const sample: number | undefined = x[sampleIndex];
    if (sample === undefined) {
      throw new RangeError(`computePeakBuckets: x[${sampleIndex}] read out of bounds`);
    }
    // Advance while the NEXT bucket starts at or before this sample. Each
    // step lands in exactly one half-open [floor(b·N/B), floor((b+1)·N/B))
    // range; empty buckets are skipped and keep their sentinel (→ 0,0).
    while (
      bucket + 1 < bucketCount &&
      Math.floor(((bucket + 1) * x.length) / bucketCount) <= sampleIndex
    ) {
      bucket += 1;
    }
    if (Number.isFinite(sample)) {
      const minIndex = 2 * bucket;
      const maxIndex = minIndex + 1;
      const min: number | undefined = minMax[minIndex];
      const max: number | undefined = minMax[maxIndex];
      if (min === undefined || max === undefined) {
        throw new RangeError(`computePeakBuckets: minMax[${minIndex}] read out of bounds`);
      }
      if (sample < min) {
        minMax[minIndex] = sample;
      }
      if (sample > max) {
        minMax[maxIndex] = sample;
      }
    }
  }
  // Untouched sentinels (empty buckets, all-non-finite buckets) → 0,0.
  for (let index = 0; index < minMax.length; index += 1) {
    const value: number | undefined = minMax[index];
    if (value === undefined) {
      throw new RangeError(`computePeakBuckets: minMax[${index}] read out of bounds`);
    }
    if (!Number.isFinite(value)) {
      minMax[index] = 0;
    }
  }
  return minMax;
}
