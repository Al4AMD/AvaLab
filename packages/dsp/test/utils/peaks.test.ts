/**
 * Peak-bucket tests. Golden-lite in the hash-test style: an inline
 * INDEPENDENT reference computed bucket-major straight from the documented
 * partition formula (the production code walks samples sample-major with an
 * advancing pointer — a different traversal of the same pinned definition),
 * plus tiny hand-computed vectors, structural properties, and guards. No new
 * Python golden: bucketing a display envelope has no NumPy counterpart worth
 * pinning beyond the definition itself.
 */
import { describe, expect, it } from "vitest";
import { computePeakBuckets } from "../../src/index.js";

/** Independent bucket-major reference: per bucket, recompute the documented
 * range [floor(b·N/B), floor((b+1)·N/B)), take min/max over finite samples,
 * 0,0 sentinel when a bucket sees no finite value. */
function referenceBuckets(x: Float32Array, bucketCount: number): Float32Array {
  if (x.length === 0) {
    return new Float32Array(0);
  }
  const out = new Float32Array(2 * bucketCount);
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor((bucket * x.length) / bucketCount);
    const end = Math.floor(((bucket + 1) * x.length) / bucketCount);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      const value: number | undefined = x[sampleIndex];
      if (value === undefined) {
        throw new RangeError(`referenceBuckets: x[${sampleIndex}] read out of bounds`);
      }
      if (Number.isFinite(value)) {
        if (value < min) {
          min = value;
        }
        if (value > max) {
          max = value;
        }
      }
    }
    out[2 * bucket] = Number.isFinite(min) ? min : 0;
    out[2 * bucket + 1] = Number.isFinite(max) ? max : 0;
  }
  return out;
}

/** Deterministic pseudo-audio in the store-test style: LCG noise on a sine. */
function fakeAudio(sampleCount: number, seedOffset = 1): Float32Array {
  let state = (0x183f2b + seedOffset * 7919) >>> 0;
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    samples[index] =
      Math.sin((2 * Math.PI * 440 * index) / 48000) * 0.4 + ((state % 2001) - 1000) / 100000;
  }
  return samples;
}

describe("hand-computed vectors", () => {
  it("5 samples in 3 buckets: exact interleaved min/max per the pinned partition", () => {
    // N = 5, B = 3 → boundaries floor(b·5/3) = 0, 1, 3, 5:
    // bucket0 = {x0}, bucket1 = {x1, x2}, bucket2 = {x3, x4}.
    const samples = new Float32Array([1, -2, 3, -0.5, 0.25]);
    expect([...computePeakBuckets(samples, 3)]).toEqual([1, 1, -2, 3, -0.5, 0.25]);
  });

  it("one bucket spans everything: the global min and max", () => {
    const samples = new Float32Array([1, -2, 3, -0.5, 0.25]);
    expect([...computePeakBuckets(samples, 1)]).toEqual([-2, 3]);
  });

  it("bucketCount = sampleCount: every bucket is exactly one sample (duplicated min/max)", () => {
    const samples = new Float32Array([0.5, -7, 4]);
    expect([...computePeakBuckets(samples, 3)]).toEqual([0.5, 0.5, -7, -7, 4, 4]);
  });

  it("bucketCount > sampleCount: exact per-sample buckets with documented 0,0 empty buckets", () => {
    // N = 2, B = 4 → boundaries floor(b·2/4) = 0, 0, 1, 1, 2:
    // bucket0 empty, bucket1 = {x0}, bucket2 empty, bucket3 = {x1}.
    const samples = new Float32Array([2, -1]);
    expect([...computePeakBuckets(samples, 4)]).toEqual([0, 0, 2, 2, 0, 0, -1, -1]);
  });

  it("empty input → empty output for a valid bucketCount", () => {
    const result = computePeakBuckets(new Float32Array(0), 4);
    expect(result.length).toBe(0);
    expect(result).toBeInstanceOf(Float32Array);
  });

  it("non-finite samples are ignored; a bucket with no finite values is the 0,0 sentinel", () => {
    // N = 3, B = 3 → bucket1 holds only NaN → 0,0.
    expect([...computePeakBuckets(new Float32Array([1, Number.NaN, 3]), 3)]).toEqual([
      1, 1, 0, 0, 3, 3,
    ]);
    // All-non-finite input: every bucket is the 0,0 sentinel.
    const allNonFinite = new Float32Array([
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]);
    expect([...computePeakBuckets(allNonFinite, 2)]).toEqual([0, 0, 0, 0]);
  });
});

describe("guards (loud app-code failures)", () => {
  const samples = new Float32Array([1, 2, 3]);
  for (const badBucketCount of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`throws RangeError for bucketCount ${String(badBucketCount)}`, () => {
      expect(() => computePeakBuckets(samples, badBucketCount)).toThrow(RangeError);
    });
  }
  it("validates bucketCount even on empty input (guards before data shape)", () => {
    expect(() => computePeakBuckets(new Float32Array(0), 0)).toThrow(RangeError);
  });
});

describe("properties", () => {
  it("matches the independent bucket-major reference on seeded random data across shapes", () => {
    for (const sampleCount of [1, 2, 3, 5, 17, 257, 1000]) {
      const samples = fakeAudio(sampleCount, sampleCount);
      for (const bucketCount of [1, 2, 3, 7, 64, sampleCount, sampleCount + 5]) {
        expect([...computePeakBuckets(samples, bucketCount)]).toEqual([
          ...referenceBuckets(samples, bucketCount),
        ]);
      }
    }
  });

  it("every bucket pair satisfies min ≤ max; global extrema are bucket extrema", () => {
    for (const seedOffset of [1, 2, 3]) {
      const samples = fakeAudio(1024, seedOffset);
      const minMax = computePeakBuckets(samples, 64);
      expect(minMax.length).toBe(128);
      let minOfMins = Number.POSITIVE_INFINITY;
      let maxOfMaxes = Number.NEGATIVE_INFINITY;
      for (let bucket = 0; bucket < 64; bucket += 1) {
        const min: number | undefined = minMax[2 * bucket];
        const max: number | undefined = minMax[2 * bucket + 1];
        if (min === undefined || max === undefined) {
          throw new Error(`property test: no bucket pair at ${String(bucket)}`);
        }
        expect(min).toBeLessThanOrEqual(max);
        minOfMins = Math.min(minOfMins, min);
        maxOfMaxes = Math.max(maxOfMaxes, max);
      }
      // The partition covers [0, N) exactly, so the bucket envelope spans the
      // global extrema of the finite samples (never above/below them).
      expect(maxOfMaxes).toBeCloseTo(Math.max(...samples), 6);
      expect(minOfMins).toBeCloseTo(Math.min(...samples), 6);
    }
  });

  it("each reported min/max is a real sample value of its own bucket", () => {
    const samples = fakeAudio(1000, 7);
    const bucketCount = 32;
    const minMax = computePeakBuckets(samples, bucketCount);
    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
      const start = Math.floor((bucket * samples.length) / bucketCount);
      const end = Math.floor(((bucket + 1) * samples.length) / bucketCount);
      const memberValues = new Set<number>();
      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        const value: number | undefined = samples[sampleIndex];
        if (value === undefined) {
          throw new Error(`sample test: no sample at ${String(sampleIndex)}`);
        }
        memberValues.add(value);
      }
      const min: number | undefined = minMax[2 * bucket];
      const max: number | undefined = minMax[2 * bucket + 1];
      if (min === undefined || max === undefined) {
        throw new Error(`sample test: no bucket pair at ${String(bucket)}`);
      }
      if (memberValues.size === 0) {
        expect(min).toBe(0); // documented 0,0 sentinel for an empty bucket
        expect(max).toBe(0);
        continue;
      }
      expect(memberValues.has(min)).toBe(true);
      expect(memberValues.has(max)).toBe(true);
    }
  });

  it("equal counts: bucket maxima equal the samples themselves", () => {
    const samples = fakeAudio(257, 11);
    const minMax = computePeakBuckets(samples, samples.length);
    for (let index = 0; index < samples.length; index += 1) {
      const sample: number | undefined = samples[index];
      const min: number | undefined = minMax[2 * index];
      const max: number | undefined = minMax[2 * index + 1];
      if (sample === undefined || min === undefined || max === undefined) {
        throw new Error(`equal-count test: no entry at ${String(index)}`);
      }
      expect(min).toBe(sample);
      expect(max).toBe(sample);
    }
  });

  it("is deterministic and never mutates the input", () => {
    const samples = fakeAudio(517, 13);
    const before = samples.slice();
    const first = computePeakBuckets(samples, 16);
    const second = computePeakBuckets(samples, 16);
    expect([...first]).toEqual([...second]);
    expect([...samples]).toEqual([...before]);
    // The result is a fresh array, not a view.
    expect(first.buffer).not.toBe(samples.buffer);
  });
});
