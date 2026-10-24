/**
 * Purpose: the F04 MDCT toy lossy codec — the teaching analogue of a real
 * MP3/AAC/Vorbis encoder, reduced to its transform + fixed-quantization core:
 * forward MDCT (plan-04 T4 amended basis) → uniform scalar quantization of the
 * spectral coefficients at an adjustable bit rate → zigzag byte split → one
 * canonical Huffman codebook (plan-04 T2) over both byte streams → IMDCT
 * overlap-add (TDAC) → resynthesized audio. Rate changes move the quantizer
 * step size, so students hear AND see the bitrate of a transform codec trade
 * against quality — the same rate-distortion knob MP3/AAC expose. What is
 * deliberately NOT included (controller ruling R16, F13 hook): no
 * psychoacoustic masking model, no per-band bit allocation, no noise shaping
 * (planned for wave 5); "entropyBitsPerCoefficient" style stats and the byte
 * serialization container are deferred to wave 4.
 *
 * Rate model (controller ruling R9, pinned verbatim):
 *   B   = bitsPerSecond · hop / sampleRateHz      (bits per frame)
 *   GM  = geometric mean of the nonzero |C_k| in the frame
 *   E   = B / hop                                  (bits per coefficient)
 *   s   = GM · 2^(−E)                             (quantizer step)
 *   q_k = clip(round(C_k / s), −32768, 32767)     (Int16 range, documented)
 * with hop = frameLengthSamples / 2 = coefficients per frame. Additional
 * pinned conventions, each with its reason:
 *   - A frame with NO nonzero coefficient has an empty geometric mean.
 *     Empty-product convention: GM = 1 and the step is pinned to exactly
 *     1.0 (the exponent factor is moot because every q is 0 either way, and
 *     step 1.0 keeps decoded silence exactly silent). Documented above.
 *   - Rounding: JavaScript `Math.round` (half up toward +∞), the same pinned
 *     tie behavior as the plan-02 uniform quantizer. Exact .5 ties are
 *     measure-zero for irrational MDCT coefficients but must be defined.
 *   - R9 keeps the exact ruling: NO dither, NO deadzone.
 *   - Saturation: at absurd rates (E beyond ~1074 bits/coeff) the step
 *     underflows to 0 and `C / s` becomes ±Infinity per IEEE 754 (NaN is
 *     impossible because the C = 0 case shortcuts to q = 0), so the index
 *     saturates at ±32768/32767 — defined behavior, documented, and decoded
 *     output then tracks the original within one step of every coefficient.
 *   - The Int16 clip is part of the interface (R9 "clipping documented"):
 *     extremely loud frames at very low rates can hit the clip, which is a
 *     fixed-level distortion students can observe.
 *
 * Actual bit accounting: the quantized indices are zigzag-mapped to unsigned
 *   u = (q < 0 ? −2q − 1 : 2q) ∈ [0, 65535]
 * (ruling R7 zigzag), split into low = u & 0xFF and high = u >>> 8 byte
 * streams of length M = frameCount·hop each (delta's combined-array order:
 * low block then high block), and Huffman-coded with ONE codebook over the
 * COMBINED histogram — `huffmanEncode(low ++ high)` produces exactly that
 * book and stream. Ruling R9 counts `bitsTotal` over "the zigzag-unsigned
 * index bytes (low/high streams, combined codebook, same layout as R8)".
 * The delta payload embedding ([u32 bitLengthLow][u32 bitLengthHigh] [256
 * codeLengths][padded low][padded high]) is, per the dispatch ruling, delta's
 * serialized interop container; this codec's encoded object is IN-MEMORY
 * ONLY (wave 4 adds byte serialization). The pinned return shape carries a
 * single `bits: Uint8Array` + single `bitLength`, which means the two logical
 * streams are packed as ONE continuous MSB-first stream and `decodeMdct`
 * splits the decoded bytes at the known count M (per-coefficient pair order:
 * frame-by-frame, k ascending — deterministic on both sides). The bit
 * ACCOUNT is identical to R8's two-padded-stream bookkeeping because code
 * lengths are per-symbol: bitLength = bitLengthLow + bitLengthHigh.
 *
 * Container (in-memory, `MdctCodecEncoded`):
 *   - `coefficients[k]`: Float64Array of the frame's quantizer indices q
 *     (exact integers in [−32768, 32767]; Float64 holds every Int16 exactly).
 *     Readout for the UI (coefficient sparsity / histogram), NOT consumed by
 *     the decode path (which re-derives q from the Huffman stream — that is
 *     the property the round-trip tests pin).
 *   - `steps`: flat Float64Array, length = frame count, holding the exact
 *     step s used per frame (R9: steps ride with the encoded object; Float64
 *     because s must round-trip losslessly — Float32 is forbidden: it would
 *     shift the dequantization). Wave 4 serializes.
 *   - `bits`, `bitLength`, `codebook`: the packed stream, its meaningful bit
 *     count (padding excluded) and the combined code length table.
 *   - `bitsTotal` equals `bitLength` by construction (both names exist so
 *     readouts and stream code share one object; documented here).
 *
 * Stats (documented exactly; R9's formulas):
 *   bitsTotal          = the Huffman bit length of the quantized q streams
 *                        ONLY. The per-frame steps are in-memory doubles;
 *                        their serialization overhead is a wave-4 concern
 *                        and is NOT included here.
 *   bitsPerSample      = bitsTotal / sampleCount (0 for empty input; delta
 *                        codec convention).
 *   bitrateKbps        = bitsTotal · sampleRateHz / sampleCount / 1000
 *                        (decimal kbps; 0 for empty; R9's exact formula).
 *   compressedSizeBytes = ceil(bitLength / 8) — packed stream bytes only.
 *
 * Decode (`decodeMdct(encoded, { sampleRateHz, frameLengthSamples })`):
 * guard the container, `huffmanDecode` the continuous stream with
 * `encoded.codebook`, split at M, un-zigzag pairs to Int16 indices, dequantize
 * per frame C'[k] = q[k]·steps[frame], `imdct`, and return Float32 samples of
 * length (frameCount − 1)·hop — the caller trims trailing (exact-zero) tail
 * samples to the original count, exactly like the raw `imdct` contract.
 * `sampleRateHz` does not enter the math (the reconstruction is rate-free);
 * it is validated for symmetry with the encode signature pinned in the plan
 * (stats readouts are wave 4). Huffman streams are not self-authenticating
 * (plan-04 T2 limitation, inherited): a corrupt middle of a valid-length
 * stream may decode silently into different bytes; the checked corruptions
 * are truncation, divergent walks and a decoded byte count that does not
 * match the container (`RangeError("truncated mdct codec stream")`).
 *
 * Reference: transform coding with MDCT/quantization as in real codecs —
 * Princen & Bradley, "Analysis/Synthesis filter bank
 * design based on time domain aliasing cancellation", IEEE Trans. ASSP 34(5),
 * 1986, and Malvar, "Lapped transforms for efficient transform/subband
 * coding", IEEE Trans. ASSP 38(6), 1990 (this library's MDCT core); rate
 * model pinned by AvaLab controller ruling R9 (.superpowers/sdd/
 * 04-codecs-and-time/progress.md); canonical Huffman per RFC 1951 §3.2.2
 * (plan-04 T2). Psychoacoustic masking is deliberately absent (R16, F13).
 *
 * Complexity: encode O(sampleCount·hop) for the MDCT/IMDCT pair (the T4
 * basis-matrix method) + O(M) quantize/zigzag/entropy + O(M·L) Huffman with
 * L ≤ 15; decode the same. Steps make the encode's per-frame exponent a
 * single constant 2^(−E) per call (E = bitsPerSecond/sampleRateHz).
 *
 *   - Rate-model limitation (R9, MEASURED, not a bug): s is set from the
 *     geometric mean over ALL nonzero coefficients, so a heavy-tailed frame
 *     (sine/DC/chirp) quantizes its dominant bins beyond the Int16 clip
 *     (measured: 40 clipped coefficients in one 440 Hz sine frame at
 *     512 kbps) — tonal inputs collapse (relRms ≈ 0.93–1.00 at all rates,
 *     structure/length still exact) while flat-spectrum inputs are near
 *     transparent (random @512 kbps: relRms 9.4e-5; 48–128 kbps SNR
 *     22–32 dB). Per-band scale factors + masking (F13) are the next rung.
 *
 * Edge cases: empty input → empty frames, `bitLength` 0, zeros stats
 * (documented 0-convention, no NaN) and an empty decode; silence → step 1.0
 * per frame, all q = 0, decoded output exactly 0 (Huffman floor: a
 * single-symbol alphabet still costs 1 bit/symbol, so silence is NOT zero
 * bits — documented); DC, impulse, chirp, non-multiple-of-hop lengths and
 * the frame-4 minimum all encode/decode without error, tonal ones with the
 * rate-model distortion above;
 * non-finite samples → `TypeError`; non-`Float32Array` samples →
 * `TypeError`; `sampleRateHz`/`bitsPerSecond` non-finite or ≤ 0 →
 * `RangeError`; `frameLengthSamples` validation is delegated to `mdct`/
 * `imdct` (even integer ≥ 4 → their typed `RangeError`) except where decode
 * needs hop before `imdct` runs, where the same rule is mirrored with a
 * `decodeMdct:` message. Inputs (samples, container) are never mutated; all
 * outputs are fresh arrays; the same input encodes to byte-identical
 * `bits` (determinism contract).
 */

import { imdct, mdct } from "../timestretch/mdct.js";
import { type HuffmanCodebook, huffmanDecode, huffmanEncode } from "./huffman.js";

/** Parameters of `encodeMdct` (dispatch-pinned signature). */
export interface MdctCodecEncodeParams {
  /** Positive finite sample rate in Hz, e.g. 48000. */
  sampleRateHz: number;
  /** Total frame length 2N in samples (even integer ≥ 4; hop = N). */
  frameLengthSamples: number;
  /** Requested encoder rate in bit/s, positive finite (e.g. 128000). */
  bitsPerSecond: number;
}

/** Statistics of the encode (documented formulas in the module header). */
export interface MdctCodecStats {
  /** Huffman bits of the quantized streams / sample count; 0 when empty. */
  bitsPerSample: number;
  /** bitsTotal · sampleRateHz / sampleCount / 1000 (decimal kbps). */
  bitrateKbps: number;
  /** Packed stream bytes: ceil(bitLength / 8). */
  compressedSizeBytes: number;
}

/**
 * In-memory encoded object (container contract in the module header). Not a
 * serialized interop format; wave 4 adds byte serialization.
 */
export interface MdctCodecEncoded {
  /** Per-frame quantizer indices q (exact Int16-range values). */
  coefficients: Float64Array[];
  /** Per-frame quantizer step s actually used, in frame order. */
  steps: Float64Array;
  /** Total meaningful Huffman bits of the packed stream (see header). */
  bitsTotal: number;
  /** Meaningful bit count of `bits` (padding excluded); equals bitsTotal. */
  bitLength: number;
  /** Continuous packed stream: [low bytes' codes][high bytes' codes]. */
  bits: Uint8Array;
  /** The single combined-stream canonical code length table. */
  codebook: { codeLengths: Uint8Array };
  stats: MdctCodecStats;
}

/** Parameters of `decodeMdct` (dispatch-pinned signature). */
export interface MdctCodecDecodeParams {
  /** Positive finite sample rate in Hz; validated, not used in the math. */
  sampleRateHz: number;
  /** Total frame length 2N in samples (even integer ≥ 4; hop = N). */
  frameLengthSamples: number;
}
// ponytail: 6-line zigzag/unzigzag duplicated from codecs/delta.ts (its copy
// is module-private); share a module if a third quantized-index codec appears.
/** R7 zigzag q → u ∈ [0, 65535]. */
function zigzag(value: number): number {
  return value < 0 ? -2 * value - 1 : 2 * value;
}

/** R7 zigzag inverse on the [0, 65535] u-domain. */
function unzigzag(unsigned: number): number {
  return (unsigned & 1) === 0 ? unsigned >>> 1 : -((unsigned >>> 1) + 1);
}

/**
 * Encode float32 audio through the MDCT toy lossy codec (full procedure in
 * the module header). Deterministic; never mutates the input; fresh output
 * arrays. Guards: `Float32Array` samples with finite values → else
 * `TypeError`; `sampleRateHz`/`bitsPerSecond` finite and > 0 → else
 * `RangeError`; `frameLengthSamples` is validated inside `mdct` (its typed
 * `RangeError` with the `mdct:` message propagates).
 */
export function encodeMdct(samples: Float32Array, params: MdctCodecEncodeParams): MdctCodecEncoded {
  if (!(samples instanceof Float32Array)) {
    throw new TypeError("encodeMdct: samples must be a Float32Array");
  }
  const { sampleRateHz, frameLengthSamples, bitsPerSecond } = params;
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError(`encodeMdct: sampleRateHz must be finite and > 0 (got ${sampleRateHz})`);
  }
  if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) {
    throw new RangeError(`encodeMdct: bitsPerSecond must be finite and > 0 (got ${bitsPerSecond})`);
  }
  // Own finite scan with this module's message (R14); mdct revalidates the
  // converted copy defensively — converting Float32→Float64 cannot create
  // inf/NaN, so its pass is a no-op on already-checked data.
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (!Number.isFinite(sample)) {
      throw new TypeError(`encodeMdct: samples[${index}] is not finite (${sample})`);
    }
  }

  const transform = mdct(new Float64Array(samples), { frameLengthSamples });
  const hop = transform.hopLengthSamples;
  const frameCount = transform.coefficients.length;
  const coefficientCount = frameCount * hop;

  // Rate model: per-frame budget B = bitsPerSecond·hop/fs; per-coefficient
  // exponent E = B/hop = bitsPerSecond/sampleRateHz (identical algebra; one
  // pow(2, −E) constant per call).
  const exponent = bitsPerSecond / sampleRateHz;
  const stepFactor = 2 ** -exponent;

  const coefficients: Float64Array[] = [];
  const steps = new Float64Array(frameCount);
  const lowBytes = new Uint8Array(coefficientCount);
  const highBytes = new Uint8Array(coefficientCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameC = transform.coefficients[frame];
    if (frameC === undefined) {
      throw new TypeError(`encodeMdct: coefficients[${frame}] read out of bounds`);
    }
    // Geometric mean of the NONZERO |C_k| (empty multiset → GM = 1, step 1).
    let logSum = 0;
    let nonZeroCount = 0;
    for (let k = 0; k < hop; k += 1) {
      const value = Math.abs(frameC[k] ?? 0);
      if (value !== 0) {
        logSum += Math.log(value);
        nonZeroCount += 1;
      }
    }
    const step = nonZeroCount === 0 ? 1 : Math.exp(logSum / nonZeroCount) * stepFactor;
    steps[frame] = step;

    const frameQ = new Float64Array(hop);
    const base = frame * hop;
    for (let k = 0; k < hop; k += 1) {
      const c = frameC[k] ?? 0;
      // q = clip(round(c/s)): c === 0 shortcuts (no 0/0 NaN); a nonexistent
      // step can only make c/s ±Infinity, which clips (header saturation).
      let q = c === 0 ? 0 : Math.round(c / step);
      q = q > 32767 ? 32767 : q < -32768 ? -32768 : q;
      frameQ[k] = q;
      const unsigned = zigzag(q);
      lowBytes[base + k] = unsigned & 0xff;
      highBytes[base + k] = unsigned >>> 8;
    }
    coefficients.push(frameQ);
  }

  // ONE canonical codebook over the COMBINED (low + high) histogram; the two
  // logical byte streams pack as one continuous MSB-first stream (header).
  const combined = new Uint8Array(2 * coefficientCount);
  combined.set(lowBytes, 0);
  combined.set(highBytes, coefficientCount);
  const packed = huffmanEncode(combined);

  const sampleCount = samples.length;
  const bitLength = packed.bitLength;
  return {
    coefficients,
    steps,
    bitsTotal: bitLength,
    bitLength,
    bits: packed.bits,
    codebook: { codeLengths: packed.codebook.codeLengths },
    stats: {
      bitsPerSample: sampleCount === 0 ? 0 : bitLength / sampleCount,
      bitrateKbps: sampleCount === 0 ? 0 : (bitLength * sampleRateHz) / sampleCount / 1000,
      compressedSizeBytes: (bitLength + 7) >> 3,
    },
  };
}

/**
 * Decode an in-memory `MdctCodecEncoded` object back to Float32 audio
 * (module header for the exact container contract). Guards: the container
 * fields must be the pinned typed arrays → else `TypeError` with the
 * `decodeMdct:` message; `sampleRateHz` finite > 0 and `bitLength` a
 * non-negative integer → else `RangeError`; `frameLengthSamples` even
 * integer ≥ 4 → else `RangeError` (mirrored rule, `decodeMdct:` message —
 * the raw `imdct` enforces the same rule again); `steps` must match the
 * frame count and each frame must hold hop coefficients → else
 * `RangeError`. Stream-level errors propagate from `huffmanDecode`
 * unchanged (`truncated bitstream`, `invalid huffman code`,
 * `invalid huffman codebook`); a decoded stream whose byte count does not
 * match the container's coefficient grid is rejected as
 * `RangeError("truncated mdct codec stream")`. Output length is
 * (frameCount − 1)·hop; the caller trims the (exact-zero) tail to the
 * original sample count. The container is only read, never mutated; the
 * result is fresh and deterministic. `sampleRateHz` is validated but does
 * not enter the math (header).
 */
export function decodeMdct(encoded: MdctCodecEncoded, params: MdctCodecDecodeParams): Float32Array {
  if (!(encoded.bits instanceof Uint8Array)) {
    throw new TypeError("decodeMdct: encoded.bits must be a Uint8Array");
  }
  if (!(encoded.codebook?.codeLengths instanceof Uint8Array)) {
    throw new TypeError("decodeMdct: encoded.codebook.codeLengths must be a Uint8Array");
  }
  if (!Array.isArray(encoded.coefficients)) {
    throw new TypeError("decodeMdct: encoded.coefficients must be an array");
  }
  if (!(encoded.steps instanceof Float64Array)) {
    throw new TypeError("decodeMdct: encoded.steps must be a Float64Array");
  }
  const { sampleRateHz, frameLengthSamples } = params;
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError(`decodeMdct: sampleRateHz must be finite and > 0 (got ${sampleRateHz})`);
  }
  // Mirrored mdct.ts rule: decode needs hop before imdct can validate.
  if (
    !Number.isInteger(frameLengthSamples) ||
    frameLengthSamples < 4 ||
    frameLengthSamples % 2 !== 0
  ) {
    throw new RangeError(
      `decodeMdct: frameLengthSamples must be an even integer >= 4 (got ${frameLengthSamples})`,
    );
  }
  const bitLength = encoded.bitLength;
  if (!Number.isInteger(bitLength) || bitLength < 0) {
    throw new RangeError(
      `decodeMdct: encoded.bitLength must be a non-negative integer (got ${bitLength})`,
    );
  }

  const frameLengths = encoded.coefficients.length;
  if (encoded.steps.length !== frameLengths) {
    throw new RangeError(
      `decodeMdct: encoded.steps holds ${encoded.steps.length} entries for ${frameLengths} frames`,
    );
  }
  const hop = frameLengthSamples / 2;
  for (let frame = 0; frame < frameLengths; frame += 1) {
    const frameC = encoded.coefficients[frame];
    if (!(frameC instanceof Float64Array)) {
      throw new TypeError(`decodeMdct: encoded.coefficients[${frame}] must be a Float64Array`);
    }
    if (frameC.length !== hop) {
      throw new RangeError(
        `decodeMdct: encoded.coefficients[${frame}] holds ${frameC.length} coefficients, expected hop ${hop}`,
      );
    }
  }

  const codebook: HuffmanCodebook = encoded.codebook;
  const decodedBytes = huffmanDecode(encoded.bits, bitLength, codebook);
  const coefficientCount = frameLengths * hop;
  if (decodedBytes.length !== 2 * coefficientCount) {
    throw new RangeError("truncated mdct codec stream");
  }

  // Un-zigzag the pairs and dequantize per frame: C'[k] = q[k]·steps[frame].
  const dequantized: Float64Array[] = [];
  for (let frame = 0; frame < frameLengths; frame += 1) {
    const frameC = new Float64Array(hop);
    const step: number | undefined = encoded.steps[frame];
    if (step === undefined) {
      throw new TypeError(`decodeMdct: encoded.steps[${frame}] read out of bounds`);
    }
    for (let k = 0; k < hop; k += 1) {
      const pairIndex = frame * hop + k;
      const low = decodedBytes[pairIndex] ?? 0;
      const high = decodedBytes[coefficientCount + pairIndex] ?? 0;
      const unsigned = low | (high << 8);
      const q = unzigzag(unsigned);
      frameC[k] = q * step;
    }
    dequantized.push(frameC);
  }

  const synthesized = imdct(dequantized, { frameLengthSamples });
  const audio = new Float32Array(synthesized.length);
  for (let index = 0; index < synthesized.length; index += 1) {
    audio[index] = synthesized[index] ?? 0;
  }
  return audio;
}
