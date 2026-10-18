/**
 * Purpose: sample-count <-> time conversion helpers shared by every tool
 * (AGENTS section 10: no magic numbers, every quantity carries its unit).
 *
 * Formulas: t = n / fs   and   n = round(t * fs)
 *
 * Reference: Oppenheim & Schafer, "Discrete-Time Signal Processing", 3rd ed.,
 * section 4.1 (periodic sampling, t = n*T with T = 1/fs).
 *
 * Complexity: O(1) time, O(1) space.
 *
 * Edge cases: sampleRateHz <= 0 or non-finite -> RangeError; both functions
 * accept non-integer inputs; secondsToSamples rounds to the nearest integer
 * sample and returns an exact integer for exact inputs.
 */

function assertValidSampleRate(sampleRateHz: number): void {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError(`sampleRateHz must be a positive finite number, got ${sampleRateHz}`);
  }
}

export function samplesToSeconds(samples: number, sampleRateHz: number): number {
  assertValidSampleRate(sampleRateHz);
  return samples / sampleRateHz;
}

export function secondsToSamples(seconds: number, sampleRateHz: number): number {
  assertValidSampleRate(sampleRateHz);
  return Math.round(seconds * sampleRateHz);
}
