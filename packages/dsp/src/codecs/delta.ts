/**
 * Purpose: first-order delta predictor (FLAC-style) plus the delta+Huffman
 * lossless codec — the F04 compression lab's "predictor + entropy coding"
 * rung. The predictor removes the largest part of the correlation of real
 * audio: samples change little between neighbours, so the residual
 * r[n] = x[n] − x[n−1] is sharply peaked at small values, and the Huffman
 * coding that follows (plan-04 T2 canonical Huffman over a byte alphabet)
 * pays for the residual spread instead of the raw signal spread. Real FLAC
 * goes further (fixed polynomial predictors of order 0..4 plus partitioned
 * Rice coding); this module pins the teaching simplification: order-1
 * wrapping Int16 difference + zigzag + low/high byte split + one Huffman
 * codebook.
 *
 * Predictor (controller ruling R7, wrapping Int16 arithmetic — documented so
 * the Int16 wrap is understood, not accidental):
 *   r[0] = x[0]
 *   r[n] = (x[n] − x[n−1] + 32768) mod 65536 − 32768
 * The wrap is mandatory and exactly reversible: a naive signed difference of
 * Int16 samples can leave [−65536, 65536), which is not representable, while
 * the modular difference lands in [−32768, 32767] by construction. A
 * full-scale transition 32767 → −32768 therefore encodes as r = +1 — one
 * step "up" on the Int16 circle — and the decode
 *   x[0] = r[0]
 *   x[n] = (x[n−1] + r[n] + 32768) mod 65536 − 32768
 * reproduces every sample exactly (the composition is the identity on Int16
 * sequences, tested bit-exactly).
 *
 * Residual → unsigned remapping (R7 zigzag): r ∈ [−32768, 32767] maps to
 *   u = (r < 0 ? −2·r − 1 : 2·r) ∈ [0, 65535]
 * with the inverse r = (u odd ? −(u >>> 1) − 1 : u >>> 1). u splits into
 * low = u & 0xFF and high = u >>> 8 (little-endian-style byte order of the
 * unsigned residual), giving two byte streams of equal length N. The zigzag
 * keeps small |r| inside the small low byte, so the high byte is nearly
 * constant over smooth audio — coding the two streams separately exploits
 * exactly that correlation (the FLAC idea that bytes with local structure
 * beat one 65536-symbol alphabet, simplified to a fixed byte split instead
 * of Rice partitions).
 *
 * Payload layout (controller rulings R7/R8; exact, little-endian):
 *   [0..3]    uint32 LE bitLengthLow  — meaningful bits of the low stream
 *   [4..7]    uint32 LE bitLengthHigh — meaningful bits of the high stream
 *   [8..263]  uint8 ×256 codeLengths  — the ONE canonical code length table
 *               over the COMBINED (low + high) byte histogram; R8 pins a
 *               single codebook (`codebook`, singular, in the interface) and
 *               both streams are coded and decoded with that one table
 *   [264 .. 264+ceil(bitLengthLow/8))         padded low-stream bytes
 *   [.. +ceil(bitLengthHigh/8))               padded high-stream bytes
 * `bitLength = bitLengthLow + bitLengthHigh`. The header makes the payload
 * self-contained: decode takes ONLY the payload (dispatch ruling) — the
 * bitLengths and the codebook ride in the header, so no second argument is
 * needed and none is accepted. Header size 8 + 256 = 264 bytes; an empty
 * input encodes to exactly the 264-byte header (bitLengths 0, lengths 0).
 *
 * Error semantics (R5/R6/R8/R14): guards reject typed up front; a payload
 * shorter than the header, or a header whose declared stream sizes do not
 * add up to the payload length, throws `RangeError("truncated
 * delta-huffman payload")`; stream-level corruption inside a length-consistent
 * payload propagates the plan-04 T2 errors `RangeError("truncated
 * bitstream")`, `RangeError("invalid huffman code")`, `RangeError("invalid
 * huffman codebook")` from `huffmanDecode` unchanged. The two decoded byte
 * streams must carry equal symbol counts (they were produced pairwise) —
 * otherwise the payload is rejected as `RangeError("truncated
 * delta-huffman payload")` instead of writing a half-sized Int16 output.
 * Huffman streams are not self-authenticating: a corrupt middle of a
 * valid-length stream may decode silently (the same documented limitation
 * as the underlying Huffman codec; the checked corruptions are truncation,
 * codebook validity and the pairwise length equality). The decode walk is
 * strictly bounded (R6), so the codec can never hang.
 *
 * Reference: J. Robinson, "FLAC: Free Lossless Audio Codec", xiph.org
 * format document (fixed predictors order 0..4, residual partitioned Rice
 * coding), reduced to order 1 + canonical Huffman per the plan intent;
 * zigzag remapping as used in Protocol Buffers varints and JPEG.
 *
 * Complexity: delta O(N); encode O(N + N·L + 256 log 256) — one histogram
 * pass over 2N bytes, the codebook build, per-symbol packing with L ≤ 15;
 * decode O(N·L). Space O(N) for each byte stream plus the payload. Integer
 * arithmetic only (Int32 intermediate, no Float64 path).
 *
 * Edge cases: empty input → header-only payload, decode → empty
 * Int16Array, `bitsPerSample = 0` (documented convention, no NaN) and
 * entropy 0; a single sample round-trips exactly (one length-1 code per
 * stream); full-scale wrap transitions 32767 ↔ −32768 round-trip exactly
 * with residuals ±1 (test pinned); silence encodes as one dominant symbol;
 * inputs are never mutated and every call returns fresh arrays.
 */

import { entropyBitsPerSymbol } from "../metrics/entropy.js";
import {
  buildCanonicalCodes,
  buildHistogram,
  type CanonicalCodes,
  type HuffmanCodebook,
  huffmanDecode,
} from "./huffman.js";

/**
 * Guard header for the payload layout: 8 header words + 256 code-length
 * bytes. A stream payload shorter than this can never be decoded.
 */
const HEADER_LENGTH = 264;

/** Wrap a signed value onto the Int16 ring [−32768, 32767] (R7 formula). */
function wrap16(value: number): number {
  return ((((value + 32768) % 65536) + 65536) % 65536) - 32768;
}

/**
 * Delta encoding: the first sample raw, then the first-order difference in
 * wrapping Int16 arithmetic (formula in the module header). Exactly
 * reversible by `deltaDecode`. Empty input → empty output; a single sample
 * copies. Non-`Int16Array` input → `TypeError` (R14). The input is only
 * read, never mutated; the output is a fresh array.
 */
export function deltaEncode(samples: Int16Array): Int16Array {
  if (!(samples instanceof Int16Array)) {
    throw new TypeError("deltaEncode: samples must be an Int16Array");
  }
  const residuals = new Int16Array(samples.length);
  if (samples.length === 0) {
    return residuals;
  }
  residuals[0] = samples[0] ?? 0;
  for (let index = 1; index < samples.length; index += 1) {
    const current = samples[index] ?? 0;
    const previous = samples[index - 1] ?? 0;
    residuals[index] = wrap16(current - previous);
  }
  return residuals;
}

/**
 * Inverse of `deltaEncode`: the wrapping cumulative sum x[n] = x[n−1] + r[n]
 * on the Int16 ring (module header). Empty input → empty output.
 * Non-`Int16Array` input → `TypeError` (R14). The input is only read, never
 * mutated; the output is a fresh array.
 */
export function deltaDecode(residuals: Int16Array): Int16Array {
  if (!(residuals instanceof Int16Array)) {
    throw new TypeError("deltaDecode: residuals must be an Int16Array");
  }
  const samples = new Int16Array(residuals.length);
  if (samples.length === 0) {
    return samples;
  }
  let accumulator = residuals[0] ?? 0;
  samples[0] = accumulator;
  for (let index = 1; index < residuals.length; index += 1) {
    accumulator = wrap16(accumulator + (residuals[index] ?? 0));
    samples[index] = accumulator;
  }
  return samples;
}

/** Zigzag r → u ∈ [0, 65535] (R7): (r < 0 ? −2r−1 : 2r); inverse r = (u odd
 * ? −(u >>> 1) − 1 : u >>> 1) inverts it exactly. */
function zigzag(residual: number): number {
  return residual < 0 ? -2 * residual - 1 : 2 * residual;
}

function unzigzag(unsigned: number): number {
  return (unsigned & 1) === 0 ? unsigned >>> 1 : -((unsigned >>> 1) + 1);
}

/** Result of `encodeLosslessDeltaHuffman`. */
export interface DeltaHuffmanEncoded {
  /** Self-contained payload: [u32 bitLengthLow][u32 bitLengthHigh]
   * [codeLengths ×256][padded low bytes][padded high bytes]. */
  payload: Uint8Array;
  /** Total meaningful bits: bitLengthLow + bitLengthHigh (0 when empty). */
  bitLength: number;
  /** The single combined-stream code length table (256 entries). */
  codebook: { codeLengths: Uint8Array };
  stats: {
    /** bitLength / sampleCount; 0 for empty input (documented). */
    bitsPerSample: number;
    /** Shannon entropy of the Int16 residuals (bits per symbol; R15). */
    entropyBitsPerSymbol: number;
  };
}

/** Result of `decodeLosslessDeltaHuffman`. */
export interface DeltaHuffmanDecoded {
  samples: Int16Array;
  stats: {
    /** Total bits / sample count; 0 for an empty payload (documents the
     * header-only payload → zero-sample convention, no NaN). */
    bitsPerSample: number;
  };
}

/**
 * MSB-first bit packing with a shared codebook — byte-for-byte the same
 * convention `huffmanEncode` uses (RFC 1951 code order, zero padding), but
 * taking the codebook as an argument, because R8 pins ONE codebook over the
 * combined low+high histogram while `huffmanEncode` always builds its own
 * per-stream codebook. Kept here as a loop rather than a change of
 * `huffmanEncode`'s pinned signature.
 */
function packStream(
  bytes: Uint8Array,
  codes: CanonicalCodes,
): { bits: Uint8Array; bitLength: number } {
  let totalBits = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    totalBits += codes.codeLengths[bytes[index] ?? 0] ?? 0;
  }
  const bits = new Uint8Array((totalBits + 7) >> 3);
  let bitCursor = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    const symbol = bytes[index] ?? 0;
    const code = codes.codes[symbol] ?? 0;
    const length = codes.codeLengths[symbol] ?? 0;
    for (let bitIndex = length - 1; bitIndex >= 0; bitIndex -= 1) {
      if (((code >> bitIndex) & 1) === 1) {
        const byte = bits[bitCursor >> 3] ?? 0;
        bits[bitCursor >> 3] = byte | (0x80 >> (bitCursor & 7));
      }
      bitCursor += 1;
    }
  }
  return { bits, bitLength: totalBits };
}

/** Writes `value` as uint32 little-endian at `offset`. */
function writeUint32Le(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

/** Reads a uint32 little-endian at `offset`. */
function readUint32Le(bytes: Uint8Array, offset: number): number {
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
    throw new RangeError("truncated delta-huffman payload");
  }
  return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
}

/**
 * Encode Int16 samples with the delta predictor and the combined-codebook
 * Huffman stage (exact procedure, module header): residuals → zigzag →
 * low/high byte streams → one canonical codebook over the combined
 * histogram → both streams packed with that one codebook → self-contained
 * payload (256-entry codebook in the header, R8+). `bitLength` counts all
 * meaningful bits of BOTH streams. `stats.bitsPerSample = bitLength /
 * sampleCount` (0 for empty); `stats.entropyBitsPerSymbol` is the Shannon
 * entropy of the Int16 residuals via plan-02 `entropyBitsPerSymbol`
 * (Int32Array widening per R15). Empty input → header-only payload,
 * `bitLength` 0, both stats 0. Non-`Int16Array` → `TypeError`; the input is
 * never mutated; deterministic for a given input.
 */
export function encodeLosslessDeltaHuffman(samples: Int16Array): DeltaHuffmanEncoded {
  if (!(samples instanceof Int16Array)) {
    throw new TypeError("encodeLosslessDeltaHuffman: samples must be an Int16Array");
  }
  const sampleCount = samples.length;
  const residuals = deltaEncode(samples);

  // Zigzag the residuals and split them into the two byte streams.
  const lowBytes = new Uint8Array(sampleCount);
  const highBytes = new Uint8Array(sampleCount);
  for (let index = 0; index < residuals.length; index += 1) {
    const unsigned = zigzag(residuals[index] ?? 0);
    lowBytes[index] = unsigned & 0xff;
    highBytes[index] = unsigned >>> 8;
  }

  // ONE codebook over the COMBINED (low + high) histogram (R8).
  const combined = new Uint8Array(2 * sampleCount);
  combined.set(lowBytes, 0);
  combined.set(highBytes, sampleCount);
  const codes = buildCanonicalCodes(buildHistogram(combined));

  const packedLow = packStream(lowBytes, codes);
  const packedHigh = packStream(highBytes, codes);

  const payload = new Uint8Array(HEADER_LENGTH + packedLow.bits.length + packedHigh.bits.length);
  writeUint32Le(payload, 0, packedLow.bitLength);
  writeUint32Le(payload, 4, packedHigh.bitLength);
  payload.set(codes.codeLengths, 8);
  payload.set(packedLow.bits, HEADER_LENGTH);
  payload.set(packedHigh.bits, HEADER_LENGTH + packedLow.bits.length);

  // Entropy of the residuals (R15): widen to Int32Array for the shared
  // estimator; negative symbols count normally.
  const entropy = entropyBitsPerSymbol(new Int32Array(residuals));
  const bitLength = packedLow.bitLength + packedHigh.bitLength;

  return {
    payload,
    bitLength,
    codebook: { codeLengths: codes.codeLengths },
    stats: {
      bitsPerSample: sampleCount === 0 ? 0 : bitLength / sampleCount,
      entropyBitsPerSymbol: entropy,
    },
  };
}

/**
 * Decode a self-contained delta+Huffman payload (exact layout in the module
 * header): read both bitLengths and the 256-entry codebook from the header,
 * walk the two streams with `huffmanDecode` (whose typed stream errors
 * propagate unchanged), pair low+high bytes back to unsigned zigzag values,
 * un-zigzag to Int16 residuals and run `deltaDecode`. Header/size
 * inconsistencies and unequal stream lengths throw
 * `RangeError("truncated delta-huffman payload")` before any large output is
 * written; a length-consistent payload with corrupted stream bytes forwards
 * the underlying Huffman errors. Empty (header-only) payload → empty
 * Int16Array, `bitsPerSample` 0. Non-`Uint8Array` payload → `TypeError`.
 * The payload is only read, never mutated; the output is a fresh array.
 */
export function decodeLosslessDeltaHuffman(payload: Uint8Array): DeltaHuffmanDecoded {
  if (!(payload instanceof Uint8Array)) {
    throw new TypeError("decodeLosslessDeltaHuffman: payload must be a Uint8Array");
  }
  if (payload.length < HEADER_LENGTH) {
    throw new RangeError("truncated delta-huffman payload");
  }
  const bitLengthLow = readUint32Le(payload, 0);
  const bitLengthHigh = readUint32Le(payload, 4);
  const codebook: HuffmanCodebook = {
    codeLengths: payload.slice(8, HEADER_LENGTH),
  };
  const paddedLowLength = (bitLengthLow + 7) >> 3;
  const paddedHighLength = (bitLengthHigh + 7) >> 3;
  if (HEADER_LENGTH + paddedLowLength + paddedHighLength !== payload.length) {
    throw new RangeError("truncated delta-huffman payload");
  }

  // Resolve both streams with the header codebook (typed stream errors of
  // `huffmanDecode` propagate unchanged; the walk is bounded, R6).
  const lowBytes = huffmanDecode(
    payload.slice(HEADER_LENGTH, HEADER_LENGTH + paddedLowLength),
    bitLengthLow,
    codebook,
  );
  const highBytes = huffmanDecode(
    payload.slice(HEADER_LENGTH + paddedLowLength),
    bitLengthHigh,
    codebook,
  );
  // The streams were produced pairwise from one residual per sample.
  if (lowBytes.length !== highBytes.length) {
    throw new RangeError("truncated delta-huffman payload");
  }

  const residuals = new Int16Array(lowBytes.length);
  for (let index = 0; index < residuals.length; index += 1) {
    const unsigned = (lowBytes[index] ?? 0) | ((highBytes[index] ?? 0) << 8);
    residuals[index] = unzigzag(unsigned);
  }
  const samples = deltaDecode(residuals);
  return {
    samples,
    stats: {
      bitsPerSample: samples.length === 0 ? 0 : (bitLengthLow + bitLengthHigh) / samples.length,
    },
  };
}
