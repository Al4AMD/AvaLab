/**
 * Purpose: Shannon entropy of a discrete symbol stream, the lower bound on
 * lossless coding cost used by the F04 compression lab and the F05 entropy
 * readout (bits per sample/symbol vs the achieved rate). Symbol values are
 * arbitrary integers: bytes for RLE/Huffman byte streams, int32 values for
 * quantized coefficients or residuals.
 *
 * Formula: H = -sum_{s} p_s * log2(p_s), where p_s = count_s / N is the
 * empirical probability of symbol s over the N input symbols. Terms with
 * p_s = 0 are omitted (0*log2(0) is defined as 0).
 *
 * Reference: C. E. Shannon, "A Mathematical Theory of Communication",
 * Bell System Technical Journal 27, 379-423 (1948). The empirical plug-in
 * estimator (histogram probabilities) is the standard definition.
 *
 * Complexity: O(N) time and O(K) space, K = number of distinct symbols.
 * Uint8Array and Int32Array are both supported; negative int32 symbols are
 * valid and counted normally.
 *
 * Edge cases: empty input -> 0 (documented convention, an empty stream costs
 * zero bits); a single distinct symbol -> 0; the result is never NaN. The
 * input is only read, never mutated.
 */

export function entropyBitsPerSymbol(symbols: Uint8Array | Int32Array): number {
  if (symbols.length === 0) {
    return 0;
  }

  const counts = new Map<number, number>();
  for (let n = 0; n < symbols.length; n += 1) {
    const symbol: number | undefined = symbols[n];
    if (symbol === undefined) {
      throw new TypeError(`entropyBitsPerSymbol: symbols[${n}] read out of bounds`);
    }
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  }

  const symbolCount = symbols.length;
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / symbolCount;
    entropy -= probability * Math.log2(probability);
  }
  // A single distinct symbol gives -0; normalize so callers observe +0.
  return entropy === 0 ? 0 : entropy;
}
