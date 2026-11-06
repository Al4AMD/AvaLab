/**
 * Purpose: shared, DOM-free data shapes for the F14 pitch/beat analysis UI.
 * Formula: n/a (types only; librosa computes the values on the backend).
 * Reference: F14 analysis contract in apps/api/src/avalab_api/analysis.
 * Complexity: n/a.
 * Edge cases: unvoiced pitch frames are `null`; probability stays 0..1.
 */

export type PitchAnalysis = {
  readonly analysisKind: "pitch";
  readonly timesSeconds: readonly number[];
  readonly f0Hz: readonly (number | null)[];
  readonly voicedProbability: readonly number[];
  readonly medianF0Hz: number | null;
  readonly voicedFraction: number;
};

export type BeatAnalysis = {
  readonly analysisKind: "beat";
  readonly tempoBpm: number;
  readonly beatTimesSeconds: readonly number[];
};

export type PitchBeatAnalysis = PitchAnalysis | BeatAnalysis;
