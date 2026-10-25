/**
 * Purpose: FNV-1a 64-bit content hash over the raw byte view of a
 * Float32Array — the inter-view identity of a session source. It is the
 * stable part of the Web-2 derived-cache keys in apps/web
 * (src/session/store.ts, spec §2.2): `op ∝ canonicalJson(params) ∝ inputHash`.
 * NOT cryptographic: no collision resistance is claimed; 64 bits only make a
 * coincidental key collision astronomically unlikely for one viewer's session.
 *
 * Formula (FNV-1a, byte at a time):
 *   h = 0xcbf29ce484222325                       (offset basis)
 *   for each byte b:  h = h XOR b
 *                     h = (h * 0x00000100000001B3) mod 2^64
 * (FNV prime = 2^40 + 2^8 + 0xb3; both constants are fixed, public-domain
 * values of the specification below.)
 *
 * Reference: L. Fowler, G. Noll, K. Vo, "The FNV Non-Cryptographic Hash
 * Algorithm" (IETF individual draft draft-eastlake-fnv), which also lists
 * the published FNV-1a-64 test vectors the test pins.
 *
 * Complexity: O(B) time over the byte view (B = 4·len bytes), O(1) space. The
 * update runs in plain Number mathematics on two 32-bit limbs (see the
 * multiply derivation in the loop), so it is allocation-free inside the loop.
 * At the heaviest legal load (5 min at 48 kHz mono = 57.6 MB; 96 kHz mono =
 * 115 MB) this is a seconds-level sequential byte walk — accepted by pre-
 * flight ruling as a once-per-load cost (the session store hashes exactly
 * once per successful loadSource).
 *
 * Endianness assumption and the documented fallback: the bytes hashed are the
 * Float32Array's underlying buffer in memory order. ECMAScript typed arrays
 * use the host's native byte order, and every mainstream JS engine (V8,
 * JavaScriptCore, SpiderMonkey, Hermes) runs on little-endian hardware, so
 * the view serializes as IEEE-754 little-endian and this hash is byte-stable
 * across real platforms. A hypothetical big-endian engine would reorder each
 * 4-byte word; the documented fallback for one is a one-time probe
 * (`new Uint8Array(new Float32Array([1]).buffer)[0] !== 0`) plus an explicit
 * wordwise re-encode (reverse every 4-byte word before hashing). Deliberately
 * NOT implemented: no big-endian JS engine is known to exist, and dead branch
 * code on every real machine buys nothing (ponytail cutting with a recorded
 * upgrade path).
 *
 * Edge cases (all hashed as raw bytes — value canonicalization is DELIBERATELY
 * rejected: it would add a per-sample branch for cases no decode produces,
 * while byte fidelity is the point of hashing the PCM representation):
 * - empty input → hash of the offset basis alone → "cbf29ce484222325"
 *   (identical to the reference-favourite empty-input FNV vector).
 * - -0 vs +0: distinct bit patterns (0x80000000 vs 0x00000000), so arrays
 *   differing only in signed zero hash differently. Real decode paths (Web
 *   Audio decodeAudioData, byte-level PCM ingest) do not mint -0 samples in
 *   practice, and the consequence of the divergence is harmless in every
 *   direction: different bytes ⇒ different key ⇒ an extra recompute, never a
 *   false cache hit ("hash the bytes as-is" per task ruling).
 * - denormals / NaN payloads: distinct bit patterns hash distinctly; the
 *   session store rejects non-finite samples before hashing, so NaNs never
 *   enter a real load's cache key, and a denormal is still a finite value
 *   with a stable encoding.
 * - never mutates the input; hashes exactly the view's own
 *   [byteOffset, byteOffset + byteLength) subrange, so a subarray view hashes
 *   only its own samples.
 */

/** Low 32-bit limb of the FNV-1a-64 offset basis 0xcbf29ce484222325. */
const FNV_OFFSET_HI = 0xcbf29ce4;
/** High 32-bit limb of the FNV-1a-64 offset basis 0xcbf29ce484222325. */
const FNV_OFFSET_LO = 0x84222325;
/** Low 32-bit limb of the FNV-1a-64 prime 0x00000100000001B3 (435). */
const FNV_PRIME_LOW = 0x1b3;

/**
 * One FNV-1a update as a 64-bit multiply mod 2^64 with the prime split into
 * limbs P = 256·2^32 + 435:
 *   (xHi·2^32 + xLo)·P = xHi·256·2^64 + xHi·435·2^32 + xLo·256·2^32 + xLo·435
 * The 2^64 part vanishes mod 2^64. xLo·435 < 2^41 and xHi·435 < 2^41 are exact
 * in a double, so limb splitting stays integer-exact with no BigInt cost.
 */
export function inputHashFnv1a64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let highLimb = FNV_OFFSET_HI;
  let lowLimb = FNV_OFFSET_LO;
  const prime = FNV_PRIME_LOW;
  const UINT32_MOD = 0x100000000;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte: number | undefined = bytes[index];
    if (byte === undefined) {
      throw new RangeError(`inputHashFnv1a64: bytes[${index}] read out of bounds`);
    }
    // JS bitwise ops are SIGNED 32-bit: force the result back to unsigned so
    // every limb stays a non-negative Number and the arithmetic stays exact.
    const xLow = (lowLimb ^ byte) >>> 0; // xor only touches the low 8 bits (byte < 256)
    const t = xLow * prime; // < 2^41, exact
    const nextLow = t % UINT32_MOD;
    const carryToHigh = (t - nextLow) / UINT32_MOD; // exact integer < 2^9
    // xLo·2^40 mod 2^64 = (xLo mod 2^24)·2^40 — the rest carries a 2^64 factor.
    const midLow = (xLow % 0x1000000) * 0x100; // < 2^32, exact
    const nextHigh = (highLimb * prime + midLow + carryToHigh) % UINT32_MOD;
    highLimb = nextHigh;
    lowLimb = nextLow;
  }
  return `${highLimb.toString(16).padStart(8, "0")}${lowLimb.toString(16).padStart(8, "0")}`;
}
