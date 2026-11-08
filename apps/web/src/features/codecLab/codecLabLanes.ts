import type { CodecLabMeta } from "../../session/ops";

export type CodecLabAggregate = {
  sampleCount: number;
  originalBytes: number;
  compressedSizeBytes: number;
  bitsPerSample: number;
  bitrateKbps: number;
  compressionRatio: number;
  entropyBitsPerSymbol: number;
  encodeMs: number;
  decodeMs: number;
  bitExact: boolean;
};

/** Sums measured per-lane codec stats; entropy is recomputed from merged histograms. */
export function aggregateCodecLanes(metas: readonly CodecLabMeta[]): CodecLabAggregate | null {
  if (metas.length === 0) {
    return null;
  }
  const histogram = new Array<number>(256).fill(0);
  let sampleCount = 0;
  let originalBytes = 0;
  let compressedSizeBytes = 0;
  let bitrateKbps = 0;
  let encodeMs = 0;
  let decodeMs = 0;
  let bitExact = true;
  for (const meta of metas) {
    sampleCount += meta.sampleCount;
    originalBytes += meta.originalBytes;
    compressedSizeBytes += meta.compressedSizeBytes;
    bitrateKbps += meta.bitrateKbps;
    encodeMs += meta.encodeMs;
    decodeMs += meta.decodeMs;
    bitExact = bitExact && meta.bitExact;
    meta.histogram.forEach((count, index) => {
      histogram[index] = (histogram[index] ?? 0) + count;
    });
  }
  const totalSymbols = histogram.reduce((sum, count) => sum + count, 0);
  const entropyBitsPerSymbol =
    totalSymbols === 0
      ? 0
      : -histogram.reduce((sum, count) => {
          if (count === 0) {
            return sum;
          }
          const p = count / totalSymbols;
          return sum + p * Math.log2(p);
        }, 0);
  return {
    sampleCount,
    originalBytes,
    compressedSizeBytes,
    bitsPerSample: sampleCount > 0 ? (compressedSizeBytes * 8) / sampleCount : 0,
    bitrateKbps,
    compressionRatio: compressedSizeBytes > 0 ? originalBytes / compressedSizeBytes : Infinity,
    entropyBitsPerSymbol,
    encodeMs,
    decodeMs,
    bitExact,
  };
}
