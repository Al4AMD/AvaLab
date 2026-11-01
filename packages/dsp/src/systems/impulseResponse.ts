/**
 * Purpose: deterministic synthetic impulse responses for the F10 reverb lab.
 * A reverb is convolution with an impulse response (LTI system view); this
 * generator supplies reproducible room/hall/plate/telephone responses so the
 * same preset never changes level or character between runs.
 *
 * Formula: with t = n / fs,
 *   env[n] = exp(-ln(1000) * t / rt60)      (amplitude falls 60 dB in rt60)
 *   h[n]   = env[n] * (2 * u[n] - 1)        (u from mulberry32(seed))
 * Room and hall add early reflections at 7/11/17/23 ms with gains
 * 0.5/0.35/0.25/0.18. Telephone then applies a 300 Hz high-pass and a
 * 3400 Hz low-pass (RBJ biquads, Q = 1/sqrt(2)) via applyFilter. Every kind is
 * finally scaled so sum(h[n]^2) = 1.
 *
 * Reference: Moorer, "About this reverberation business", Computer Music
 * Journal 3(2), 1979 (exponentially decaying noise and early reflections);
 * Schroeder, "Natural sounding artificial reverberation", Journal of the Audio
 * Engineering Society 10(3), 1962 (exponential decay / RT60); Bristow-Johnson,
 * Audio EQ Cookbook (biquad coefficients). The RNG stream is JavaScript
 * specific, so this generator is property-tested rather than pinned to a
 * cross-language golden vector.
 *
 * Complexity: O(N) time and O(N) space for N = round(duration * fs) samples;
 * the telephone filters add O(N) each.
 *
 * Edge cases: sampleRateHz must be a finite positive integer, durationSeconds
 * and rt60Seconds finite and > 0, seed finite -> RangeError otherwise. The
 * rounded sample count must be a safe integer > 0 and the generated response
 * must have non-zero energy -> RangeError. Low sample rates clamp the
 * telephone band to stay below Nyquist. No input is mutated; every call
 * returns a fresh Float64Array.
 */

import { biquadHighpass, biquadLowpass } from "../filters/biquad.js";
import { applyFilter } from "../filters/iir.js";
import { mulberry32 } from "../signals/noise.js";

export type SyntheticIrKind = "room" | "hall" | "plate" | "telephone";

export interface SyntheticIrParams {
  kind: SyntheticIrKind;
  sampleRateHz: number;
  durationSeconds: number;
  rt60Seconds: number;
  seed: number;
}

const DECAY_PER_RT60 = Math.log(1000);
const EARLY_REFLECTION_MS = [7, 11, 17, 23] as const;
const EARLY_REFLECTION_GAINS = [0.5, 0.35, 0.25, 0.18] as const;
const TELEPHONE_HIGHPASS_HZ = 300;
const TELEPHONE_LOWPASS_HZ = 3_400;

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`generateSyntheticIr: ${label} must be finite and > 0 (got ${value})`);
  }
}

export function generateSyntheticIr(params: SyntheticIrParams): Float64Array {
  const { kind, sampleRateHz, durationSeconds, rt60Seconds, seed } = params;
  if (!Number.isFinite(sampleRateHz) || !Number.isInteger(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError(
      `generateSyntheticIr: sampleRateHz must be a finite positive integer (got ${sampleRateHz})`,
    );
  }
  assertPositiveFinite(durationSeconds, "durationSeconds");
  assertPositiveFinite(rt60Seconds, "rt60Seconds");
  if (!Number.isFinite(seed)) {
    throw new RangeError(`generateSyntheticIr: seed must be finite (got ${seed})`);
  }

  const sampleCount = Math.round(durationSeconds * sampleRateHz);
  if (!Number.isSafeInteger(sampleCount) || sampleCount <= 0) {
    throw new RangeError(
      `generateSyntheticIr: durationSeconds * sampleRateHz must be a positive safe integer (got ${sampleCount})`,
    );
  }

  const random = mulberry32(Math.trunc(seed));
  const response = new Float64Array(sampleCount);
  for (let n = 0; n < sampleCount; n += 1) {
    const timeSeconds = n / sampleRateHz;
    const envelope = Math.exp((-DECAY_PER_RT60 * timeSeconds) / rt60Seconds);
    response[n] = envelope * (2 * random() - 1);
  }

  if (kind === "room" || kind === "hall") {
    for (let index = 0; index < EARLY_REFLECTION_MS.length; index += 1) {
      const milliseconds = EARLY_REFLECTION_MS[index] ?? 0;
      const gain = EARLY_REFLECTION_GAINS[index] ?? 0;
      const tap = Math.round((milliseconds / 1000) * sampleRateHz);
      if (tap < sampleCount) {
        response[tap] = (response[tap] ?? 0) + gain;
      }
    }
  }

  let filtered: Float64Array = response;
  if (kind === "telephone") {
    const nyquistHz = sampleRateHz / 2;
    const highpassHz = Math.min(TELEPHONE_HIGHPASS_HZ, nyquistHz * 0.4);
    const lowpassHz = Math.min(TELEPHONE_LOWPASS_HZ, nyquistHz * 0.8);
    filtered = applyFilter(
      filtered,
      biquadHighpass({ frequencyHz: highpassHz, q: Math.SQRT1_2, sampleRateHz }),
    );
    filtered = applyFilter(
      filtered,
      biquadLowpass({ frequencyHz: lowpassHz, q: Math.SQRT1_2, sampleRateHz }),
    );
  }

  let energy = 0;
  for (const sample of filtered) {
    energy += sample * sample;
  }
  if (!Number.isFinite(energy) || energy <= 0) {
    throw new RangeError("generateSyntheticIr: response has zero or non-finite energy");
  }
  const scale = 1 / Math.sqrt(energy);
  for (let n = 0; n < filtered.length; n += 1) {
    filtered[n] = (filtered[n] ?? 0) * scale;
  }
  return filtered;
}
