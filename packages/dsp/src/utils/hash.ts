/**
 * Purpose: content hash over a Float32Array — the inter-view identity of a
 * session source. It is the stable part of the Web-2 derived-cache keys in
 * apps/web (src/session/store.ts, spec §2.2): `op + canonicalJson(params) + inputHash`. NOT cryptographic; 64 output bits only make a coincidental key
 * collision astronomically unlikely for one viewer's session.
 *
 * Why not byte-wise FNV-1a-64: the published FNV recurrence visits all 4·N
 * bytes and does 64-bit limb arithmetic per byte. On the heaviest legal load
 * (5 min at 44.1 kHz mono = 52.9 MB of samples) that is a seconds-level main
 * thread walk, which violates the AGENTS §9 waveform-overview budget. This
 * hash instead visits N 32-bit words (4× fewer iterations) and runs two
 * independent 32-bit FNV-1a lanes, concatenating their outputs:
 *
 *   hA = 0x811c9dc5; hB = 0x9e3779b9
 *   for each 32-bit sample word w:
 *     hA = (hA XOR w) · 0x01000193 mod 2^32
 *     hB = (hB XOR w) · 0x9e3779b1 mod 2^32
 *   output = hex8(fmix32(hA)) || hex8(fmix32(hB))
 *
 * Each lane uses the FNV-1a update (XOR then multiply by an odd constant);
 * the lanes differ in offset basis and multiplier, so their outputs are not
 * identical. Both recurrences are bijections mod 2^32, hence any one changed
 * word changes both lane outputs. Each lane is finished with MurmurHash3's
 * fmix32 avalanche step to fix FNV-1a's weak low-bit diffusion. The pair is a
 * 64-bit fingerprint, not a standard FNV-1a-64 value.
 *
 * Reference: L. Fowler, G. Noll, K. Vo, "The FNV Non-Cryptographic Hash
 * Algorithm" (IETF draft-eastlake-fnv) for the FNV-1a update and constants;
 * A. Appleby, "MurmurHash3" (public-domain fmix32 finalizer).
 *
 * Complexity: O(N) words (N = sample count), O(1) space, no allocation inside
 * the loop. The word view is native-endian (Float32Array/Uint32Array share the
 * buffer encoding); the result is stable on every real JS platform, all of
 * which are little-endian. A cache key is local to one browser session, so
 * cross-language reproducibility is not required.
 *
 * Stereo playback uses `inputHash64Channels`: one channel delegates to
 * `inputHash64` unchanged; two channels seed both lanes with the channel count
 * before walking channel 0 and then channel 1, so a stereo pair cannot alias
 * the mono concatenation. Inputs are never mutated.
 *
 * Edge cases:
 * - empty input → fmix32 of both offset bases → "ab3e7c0b92ca2f0e".
 * - -0 vs +0: distinct bit patterns (0x80000000 vs 0x00000000) hash
 *   differently; no value canonicalization is attempted.
 * - denormals / NaN payloads: distinct bit patterns remain distinct; the
 *   session store rejects non-finite samples before hashing a real source.
 * - never mutates the input; hashes exactly the view's own
 *   [byteOffset, byteOffset + byteLength) subrange.
 */

import type { AudioChannels } from "../audio.js";

/** 32-bit FNV-1a offset basis for lane A. */
const FNV32_OFFSET_A = 0x811c9dc5;
/** 32-bit FNV-1a prime for lane A (2^24 + 2^8 + 0x93). */
const FNV32_PRIME_A = 0x01000193;
/** Golden-ratio offset basis for lane B (distinct lane seed). */
const FNV32_OFFSET_B = 0x9e3779b9;
/** Odd 32-bit prime for lane B (0x9e3779b1). */
const FNV32_PRIME_B = 0x9e3779b1;

/** MurmurHash3 fmix32 avalanche: mixes each lane's 32 bits after the walk. */
function fmix32(value: number): number {
  let hash = value;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash;
}

/**
 * Two-lane FNV-1a fingerprint of the sample words. The loop intentionally
 * keeps signed 32-bit intermediates (Math.imul/XOR); only the emitted hex
 * values are normalized with `>>> 0`.
 */
export function inputHash64(samples: Float32Array): string {
  const words = new Uint32Array(samples.buffer, samples.byteOffset, samples.byteLength / 4);
  let laneA = FNV32_OFFSET_A;
  let laneB = FNV32_OFFSET_B;
  for (let index = 0; index < words.length; index += 1) {
    const word: number | undefined = words[index];
    if (word === undefined) {
      throw new RangeError(`inputHash64: words[${index}] read out of bounds`);
    }
    laneA = Math.imul(laneA ^ word, FNV32_PRIME_A);
    laneB = Math.imul(laneB ^ word, FNV32_PRIME_B);
  }
  return `${(fmix32(laneA) >>> 0).toString(16).padStart(8, "0")}${(fmix32(laneB) >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

/**
 * Two-lane FNV-1a fingerprint of one or two playback channels. One channel
 * returns `inputHash64` exactly, preserving every mono cache key. A stereo
 * pair seeds the walk with the channel count before visiting both lanes, so
 * the hash is channel-aware without concatenating the audio.
 */
export function inputHash64Channels(channels: AudioChannels): string {
  if (channels.length === 1) {
    const only = channels[0];
    if (only === undefined) {
      throw new RangeError("inputHash64Channels: channels[0] is undefined");
    }
    return inputHash64(only);
  }
  if (channels.length !== 2) {
    throw new RangeError(
      `inputHash64Channels: expected 1 or 2 channels (got ${String(channels.length)})`,
    );
  }
  const first = channels[0];
  const second = channels[1];
  if (!(first instanceof Float32Array) || !(second instanceof Float32Array)) {
    throw new TypeError("inputHash64Channels: every channel must be a Float32Array");
  }
  if (first.length !== second.length) {
    throw new RangeError(
      `inputHash64Channels: unequal channel lengths (${String(first.length)} vs ${String(second.length)})`,
    );
  }

  const firstWords = new Uint32Array(first.buffer, first.byteOffset, first.byteLength / 4);
  const secondWords = new Uint32Array(second.buffer, second.byteOffset, second.byteLength / 4);
  let laneA = Math.imul(FNV32_OFFSET_A ^ channels.length, FNV32_PRIME_A);
  let laneB = Math.imul(FNV32_OFFSET_B ^ channels.length, FNV32_PRIME_B);
  for (const words of [firstWords, secondWords]) {
    for (let index = 0; index < words.length; index += 1) {
      const word: number | undefined = words[index];
      if (word === undefined) {
        throw new RangeError(`inputHash64Channels: words[${index}] read out of bounds`);
      }
      laneA = Math.imul(laneA ^ word, FNV32_PRIME_A);
      laneB = Math.imul(laneB ^ word, FNV32_PRIME_B);
    }
  }
  return `${(fmix32(laneA) >>> 0).toString(16).padStart(8, "0")}${(fmix32(laneB) >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}
