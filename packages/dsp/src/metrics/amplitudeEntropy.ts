/**
 * Purpose: amplitude histogram and Shannon entropy of an audio selection,
 * shown in the F02 waveform lab. Audio samples are floats, so entropy needs a
 * finite symbol alphabet: each sample is quantized to a signed N-bit PCM value
 * (N = 1..16) and the resulting 2^N amplitude bins are counted.
 *
 * Formula: pcm16[n] = round(clip(x[n], -1, 1) * (x[n] < 0 ? 32768 : 32767));
 * q[n] = pcm16[n] >> (16 - N) (arithmetic shift); s[n] = q[n] + 2^(N-1) maps
 * the signed code to histogram index 0..2^N-1. Then
 * H = -sum_s (count_s / M) * log2(count_s / M), where M is the number of
 * samples and count_s is the number of samples in symbol s. The entropy is in
 * bits per sample; H_max = N for a uniform distribution over all symbols.
 *
 * Reference: C. E. Shannon, "A Mathematical Theory of Communication", Bell
 * System Technical Journal 27, 379-423 (1948); quantization grid as in
 * `floatToInt16Pcm` (AvaLab F03).
 *
 * Complexity: O(M + 2^N) time and O(2^N) space.
 *
 * Edge cases: empty input -> sampleCount 0 and entropy 0 with an all-zero
 * histogram; a constant signal -> entropy 0; values outside [-1, 1] clip;
 * NaN or +/-Infinity -> TypeError. `bitsPerSymbol` must be an integer in
 * [1, 16], otherwise RangeError. The input is only read, never mutated.
 */

import { floatToInt16Pcm } from "../codecs/pcmWav.js";
import { entropyFromHistogram } from "./entropy.js";

export interface QuantizedAmplitudeEntropyResult {
  /** Number of samples analyzed. */
  readonly sampleCount: number;
  /** Quantization depth used for the symbol alphabet (1..16). */
  readonly bitsPerSymbol: number;
  /** Shannon entropy of the quantized amplitude distribution, bits/sample. */
  readonly entropyBitsPerSample: number;
  /** Dense histogram; length is 2^bitsPerSymbol, index 0 = most negative. */
  readonly histogram: Uint32Array;
}

export function quantizedAmplitudeEntropy(
  samples: Float32Array | Float64Array,
  bitsPerSymbol: number,
): QuantizedAmplitudeEntropyResult {
  if (!Number.isInteger(bitsPerSymbol) || bitsPerSymbol < 1 || bitsPerSymbol > 16) {
    throw new RangeError(
      `quantizedAmplitudeEntropy: bitsPerSymbol must be an integer in [1, 16], got ${String(bitsPerSymbol)}`,
    );
  }

  const pcm = floatToInt16Pcm(samples);
  const symbolCount = 2 ** bitsPerSymbol;
  const histogram = new Uint32Array(symbolCount);
  const shift = 16 - bitsPerSymbol;
  const offset = 2 ** (bitsPerSymbol - 1);

  for (let index = 0; index < pcm.length; index += 1) {
    const symbol = ((pcm[index] ?? 0) >> shift) + offset;
    histogram[symbol] = (histogram[symbol] ?? 0) + 1;
  }

  return {
    sampleCount: pcm.length,
    bitsPerSymbol,
    entropyBitsPerSample: entropyFromHistogram(histogram),
    histogram,
  };
}
