/**
 * Purpose: the 16-bit PCM grid and canonical mono WAV container shared by the
 * F04 browser compression lab. Every hand-written codec in the lab consumes
 * Int16 samples (the byte-oriented codecs operate on the little-endian PCM
 * bytes), so these helpers are the single conversion seam between the
 * session's Float32 audio and the codec modules. `encodeWavPcm16` is also
 * the exact upload format for the backend real-codec lane (D-026).
 *
 * Formulas:
 *   int16[n] = clip(round(x[n] * 32768), -32768, 32767)  for x[n] < 0
 *   int16[n] = clip(round(x[n] * 32767), -32768, 32767)  for x[n] >= 0
 *   float[n] = int16[n] / 32768
 * The asymmetric positive scale is deliberate: +1 maps to +32767 (the
 * largest Int16) while -1 maps to -32768, and the inverse divide by 32768
 * recovers the same grid exactly. Clipping (not rejection) of |x| > 1 matches
 * the G.711 and quantizer conventions in this library.
 *
 * WAV layout (44-byte canonical header, 1 or 2 channels, 16-bit PCM,
 * little-endian; C = channel count, N = frames):
 *   0  "RIFF"     4  uint32 36 + 2CN     8  "WAVE"
 *   12 "fmt "     16 uint32 16           20 uint16 1 (PCM)
 *   22 uint16 C                          24 uint32 sampleRateHz
 *   28 uint32 sampleRateHz * 2C          32 uint16 2C (block align)
 *   34 uint16 16 (bits per sample)       36 "data"
 *   40 uint32 2CN                        44 int16[frame][channel] interleaved
 *
 * Reference: RIFF/WAVE PCM format (Microsoft Multimedia Standards Update,
 * 1991); the Int16 grid convention follows G.711's `clip(round(x*32768))`
 * and the library's quantizer.
 *
 * Complexity: O(N) time and O(N) output space per call.
 *
 * Edge cases: non-finite input -> TypeError; empty input -> empty Int16
 * arrays and a valid 44-byte WAV header; odd byte length -> the pinned
 * RangeError; sample rates must be positive integers <= 192000; inputs are
 * never mutated and every call returns a fresh array. Stereo input must be
 * two equal-length Float32 lanes; mono output is byte-identical to the
 * pre-stereo encoder.
 */

import type { AudioChannels } from "../audio.js";

/** Options of `encodeWavPcm16`; the only variable header field is the rate. */
export interface WavPcm16Options {
  sampleRateHz: number;
}

const WAV_HEADER_BYTES = 44;
const MAX_SAMPLE_RATE_HZ = 192_000;

/**
 * Convert float samples to the signed 16-bit PCM grid. Values outside
 * [-1, 1] are clipped; NaN and +/-Infinity are rejected. The input is only
 * read, never mutated.
 */
export function floatToInt16Pcm(samples: Float32Array | Float64Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    if (!Number.isFinite(sample)) {
      throw new TypeError(
        `floatToInt16Pcm: samples[${index}] must be finite (got ${String(sample)})`,
      );
    }
    const clipped = Math.max(-1, Math.min(1, sample));
    pcm[index] = clipped < 0 ? Math.round(clipped * 32768) : Math.round(clipped * 32767);
  }
  return pcm;
}

/**
 * Convert signed 16-bit PCM back to float full scale by dividing by 32768.
 * Returns a fresh Float32Array; the input is only read, never mutated.
 */
export function int16PcmToFloat(samples: Int16Array): Float32Array {
  const floats = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    floats[index] = (samples[index] ?? 0) / 32768;
  }
  return floats;
}

/**
 * Serialize Int16 samples as little-endian byte pairs (the byte domain the
 * RLE, Huffman and G.711 codecs consume). Fresh Uint8Array of length 2N.
 */
export function int16PcmToBytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(index * 2, samples[index] ?? 0, true);
  }
  return bytes;
}

/**
 * Parse little-endian Int16 pairs back to samples. An odd byte length is
 * rejected with the pinned `RangeError("bytesToInt16Pcm: odd byte length")`.
 */
export function bytesToInt16Pcm(bytes: Uint8Array): Int16Array {
  if (bytes.length % 2 !== 0) {
    throw new RangeError("bytesToInt16Pcm: odd byte length");
  }
  const samples = new Int16Array(bytes.length / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true);
  }
  return samples;
}

/**
 * Encode float samples as a canonical 16-bit PCM WAV. A bare `Float32Array`
 * is mono; an `AudioChannels` array is one or two equal-length lanes. Mono
 * output is byte-identical to the previous encoder. `sampleRateHz` must be a
 * positive integer <= 192000; empty input produces a valid header-only file.
 */
export function encodeWavPcm16(
  source: Float32Array | AudioChannels,
  options: WavPcm16Options,
): Uint8Array {
  const { sampleRateHz } = options;
  if (!Number.isInteger(sampleRateHz) || sampleRateHz <= 0 || sampleRateHz > MAX_SAMPLE_RATE_HZ) {
    throw new RangeError(
      `encodeWavPcm16: sampleRateHz must be a positive integer <= ${MAX_SAMPLE_RATE_HZ} (got ${String(sampleRateHz)})`,
    );
  }
  const channels = normalizeChannels(source);
  const channelCount = channels.length;
  const frameCount = channels[0]?.length ?? 0;
  const dataBytes = frameCount * channelCount * 2;
  const bytes = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  writeTag(bytes, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeTag(bytes, 8, "WAVE");
  writeTag(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * 2 * channelCount, true);
  view.setUint16(32, 2 * channelCount, true);
  view.setUint16(34, 16, true);
  writeTag(bytes, 36, "data");
  view.setUint32(40, dataBytes, true);
  if (channelCount === 1) {
    const pcm = floatToInt16Pcm(channels[0] ?? new Float32Array(0));
    bytes.set(int16PcmToBytes(pcm), WAV_HEADER_BYTES);
    return bytes;
  }
  const pcmChannels = channels.map((channel) => floatToInt16Pcm(channel));
  let offset = WAV_HEADER_BYTES;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const pcm = pcmChannels[channel];
      const sample = pcm?.[frame] ?? 0;
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }
  return bytes;
}

function normalizeChannels(source: Float32Array | AudioChannels): readonly Float32Array[] {
  if (source instanceof Float32Array) {
    return [source];
  }
  if (!Array.isArray(source) || source.length < 1 || source.length > 2) {
    throw new RangeError(`encodeWavPcm16: expected 1 or 2 channels (got ${String(source.length)})`);
  }
  for (const channel of source) {
    if (!(channel instanceof Float32Array)) {
      throw new TypeError("encodeWavPcm16: every channel must be a Float32Array");
    }
  }
  const first = source[0];
  const second = source[1];
  if (first !== undefined && second !== undefined && first.length !== second.length) {
    throw new RangeError(
      `encodeWavPcm16: unequal channel lengths (${String(first.length)} vs ${String(second.length)})`,
    );
  }
  return source;
}

function writeTag(bytes: Uint8Array, offset: number, tag: string): void {
  for (let index = 0; index < 4; index += 1) {
    bytes[offset + index] = tag.charCodeAt(index);
  }
}
