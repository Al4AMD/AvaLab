/**
 * Purpose: predicted fold-back frequency of a tone sampled at a lower rate
 * (F03 aliasing demo, Plan 02 Task 1).
 *
 * Formula: f_alias = |f - fs·round(f/fs)|, the absolute distance from the
 * input frequency to the nearest multiple of the sample rate. The result lies
 * in [0, fs/2] and equals f itself when f is already below Nyquist.
 *
 * Reference: Oppenheim & Schafer, *Discrete-Time Signal Processing*, 3rd ed.,
 * §4.6 (sampling and aliasing); the same fold is exercised by the unfiltered
 * `resampleRational` path.
 *
 * Complexity: O(1) time and space.
 *
 * Edge cases: fs/2 stays at fs/2 (Math.round ties up); f = fs folds to 0;
 * negative f uses its magnitude; non-finite arguments or fs <= 0 throw
 * RangeError.
 */

export function aliasFrequencyHz(inputFrequencyHz: number, sampleRateHz: number): number {
  if (!Number.isFinite(inputFrequencyHz) || !Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError(
      `aliasFrequencyHz: invalid arguments (f = ${String(inputFrequencyHz)}, fs = ${String(sampleRateHz)})`,
    );
  }
  return Math.abs(inputFrequencyHz - sampleRateHz * Math.round(inputFrequencyHz / sampleRateHz));
}
