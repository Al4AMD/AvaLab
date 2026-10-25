import { describe, expect, it } from "vitest";
import type { HuffmanCodebook } from "../../src/index.js";
import {
  buildCanonicalCodes,
  buildHistogram,
  entropyBitsPerSymbol,
  huffmanDecode,
  huffmanEncode,
  mulberry32,
  validatePrefixFree,
} from "../../src/index.js";

function mulberryBytes(seed: number, length: number): Uint8Array {
  const next = mulberry32(seed);
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(next() * 256);
  }
  return bytes;
}

/** Round-trip assertion for the adversarial input set (Review Focus 1). */
function expectRoundTripBitExact(bytes: Uint8Array, label: string): void {
  const encoded = huffmanEncode(bytes);
  const decoded = huffmanDecode(encoded.bits, encoded.bitLength, encoded.codebook);
  expect(Array.from(decoded), label).toEqual(Array.from(bytes));
}

/** Pins an exact RangeError instance and message (R6: exact error strings). */
function expectExactRangeError(action: () => unknown, message: string): void {
  let caught: Error | undefined;
  try {
    action();
  } catch (error) {
    caught = error as Error;
  }
  expect(caught, `expected RangeError("${message}")`).toBeInstanceOf(RangeError);
  expect(caught?.message, `expected RangeError("${message}")`).toBe(message);
}

/** Pins an exact TypeError instance (R14 guard rule). */
function expectExactTypeError(action: () => unknown, message: string): void {
  let caught: Error | undefined;
  try {
    action();
  } catch (error) {
    caught = error as Error;
  }
  expect(caught, `expected TypeError("${message}")`).toBeInstanceOf(TypeError);
  expect(caught?.message, `expected TypeError("${message}")`).toBe(message);
}

/** Alias so cast-invalid arguments stay readable at the guard assertions. */
function asBytes(value: unknown): Uint8Array {
  return value as Uint8Array;
}

/**
 * "abracadabra" derivation (documented; verified against the pinned heap
 * order — frequency asc, then min-symbol asc, then creation sequence):
 * leaves a=5(b97), b=2(b98), r=2(b114), c=1(b99), d=1(b100).
 * merge c,d → 2(99); pool {a5(97), b2(98), r2(114), cd2(99)}: merges
 * b+cd → 4(98); r+that → 6(98); a+that → root 11.
 * Lengths: a 1, r 2, b 3, c 4, d 4. Canonical codes (RFC 1951 §3.2.2,
 * sorted by length then symbol): a="0", r="10", b="110", c="1110", d="1111".
 * Encoded stream "abracadabra" = a|b|r|a|c|a|d|a|b|r|a
 * = 0|110|10|0|1110|0|1111|0|110|10|0
 * = 23 bits = 0x69 0xCF 0x68|pad.
 */
const ABRA_TEXT = Uint8Array.from(
  "abracadabra".split("").map((character) => character.charCodeAt(0)),
);

/** F1..F28 byte streams: deep-skew histogram whose tree depths exceed 15. */
function fibonacciBytes(): Uint8Array {
  const frequencies: number[] = [1, 1];
  for (let index = 2; index < 28; index += 1) {
    frequencies[index] = (frequencies[index - 1] ?? 0) + (frequencies[index - 2] ?? 0);
  }
  const total = frequencies.reduce((sum, value) => sum + value, 0);
  expect(total).toBeLessThan(1_100_000);
  const bytes = new Uint8Array(total);
  let position = 0;
  for (let symbol = 0; symbol < frequencies.length; symbol += 1) {
    const count = frequencies[symbol];
    if (count === undefined) {
      throw new Error("fixture construction error");
    }
    bytes.fill(symbol, position, position + count);
    position += count;
  }
  return bytes;
}

/** Raw u32 histogram of Fibonacci weights F1..F47 (u32-safe, F48 is not). */
function fibonacciHistogram(): Uint32Array {
  const histogram = new Uint32Array(256);
  let previous = 1;
  let current = 1;
  for (let symbol = 200; symbol > 200 - 47; symbol -= 1) {
    histogram[symbol] = previous >>> 0;
    const next = previous + current;
    previous = current;
    current = next;
  }
  return histogram;
}

describe("huffman buildHistogram", () => {
  it("counts bytes into 256 bins and never mutates the input", () => {
    const input = Uint8Array.from([7, 7, 255, 0]);
    const inputCopy = Uint8Array.from(input);
    const histogram = buildHistogram(input);
    expect(histogram).toBeInstanceOf(Uint32Array);
    expect(histogram).toHaveLength(256);
    expect(histogram[7]).toBe(2);
    expect(histogram[255]).toBe(1);
    expect(histogram[0]).toBe(1);
    expect(Array.from(input)).toEqual(Array.from(inputCopy));
  });

  it("returns an all-zero histogram for empty input", () => {
    const histogram = buildHistogram(new Uint8Array(0));
    expect(histogram).toHaveLength(256);
    for (let bin = 0; bin < 256; bin += 1) {
      expect(histogram[bin]).toBe(0);
    }
  });
});

describe("huffman buildCanonicalCodes", () => {
  it("gives an all-zero histogram an empty codebook (maxLength 0)", () => {
    const codes = buildCanonicalCodes(new Uint32Array(256));
    expect(codes.maxLength).toBe(0);
    for (let symbol = 0; symbol < 256; symbol += 1) {
      expect(codes.codeLengths[symbol]).toBe(0);
      expect(codes.codes[symbol]).toBe(0);
    }
  });

  it("gives a single symbol a length-1 decodable code (R6)", () => {
    const codes = buildCanonicalCodes(buildHistogram(Uint8Array.from([42, 42, 42])));
    expect(codes.maxLength).toBe(1);
    expect(codes.codeLengths[42]).toBe(1);
    expect(codes.codes[42]).toBe(0);
  });

  it("matches the hand-derived abracadabra lengths, codes and bitstream", () => {
    const codes = buildCanonicalCodes(buildHistogram(ABRA_TEXT));
    // Derived in the helper docstring above; every unused symbol stays 0.
    expect(codes.codeLengths[97]).toBe(1); // a
    expect(codes.codeLengths[114]).toBe(2); // r
    expect(codes.codeLengths[98]).toBe(3); // b
    expect(codes.codeLengths[99]).toBe(4); // c
    expect(codes.codeLengths[100]).toBe(4); // d
    expect(codes.codes[97]).toBe(0b0);
    expect(codes.codes[114]).toBe(0b10);
    expect(codes.codes[98]).toBe(0b110);
    expect(codes.codes[99]).toBe(0b1110);
    expect(codes.codes[100]).toBe(0b1111);
    // Spot-check zero-frequency symbols keep length 0.
    expect(codes.codeLengths[0]).toBe(0);
    expect(codes.codeLengths[255]).toBe(0);
    expect(codes.maxLength).toBe(4);

    // The pinned MSB-first packing of the derived codewords, byte-exact.
    const encoded = huffmanEncode(ABRA_TEXT);
    expect(encoded.bitLength).toBe(23);
    expect(Array.from(encoded.bits)).toEqual([0x69, 0xcf, 0x68]);
    expect(Array.from(huffmanDecode(encoded.bits, encoded.bitLength, encoded.codebook))).toEqual(
      Array.from(ABRA_TEXT),
    );
  });

  it("builds the deterministic uniform-256 codebook: every length 8", () => {
    const histogram = buildHistogram(Uint8Array.from({ length: 512 }, (_, index) => index % 256));
    const codes = buildCanonicalCodes(histogram);
    expect(codes.maxLength).toBe(8);
    for (let symbol = 0; symbol < 256; symbol += 1) {
      expect(codes.codeLengths[symbol]).toBe(8);
      expect(codes.codes[symbol]).toBe(symbol);
    }
  });

  it("is deterministic: the same histogram always yields the same codebook", () => {
    const bytes = mulberryBytes(11, 4096);
    const codesA = buildCanonicalCodes(buildHistogram(bytes));
    const codesB = buildCanonicalCodes(buildHistogram(bytes));
    expect(Array.from(codesA.codeLengths)).toEqual(Array.from(codesB.codeLengths));
    expect(Array.from(codesA.codes)).toEqual(Array.from(codesB.codes));
    expect(codesA.maxLength).toBe(codesB.maxLength);
  });

  it("enforces the 15-bit limit on a Fibonacci-skewed histogram (fallback)", () => {
    const codes = buildCanonicalCodes(fibonacciHistogram());
    const used = Array.from(codes.codeLengths).filter((length) => length > 0);
    expect(codes.maxLength).toBeLessThanOrEqual(15);
    // The unrestricted tree of 47 Fibonacci weights exceeds depth 15, so the
    // clamped/repair fallback must have engaged: a length-15 code exists.
    expect(used).toContain(15);
    expect(used.every((length) => length <= 15)).toBe(true);
    expect(validatePrefixFree(codes.codeLengths)).toBe(true);
  });
});

describe("huffman encode", () => {
  it("encodes empty input to an empty stream (bitLength 0)", () => {
    const encoded = huffmanEncode(new Uint8Array(0));
    expect(encoded.bitLength).toBe(0);
    expect(encoded.bits).toHaveLength(0);
    for (let symbol = 0; symbol < 256; symbol += 1) {
      expect(encoded.codebook.codeLengths[symbol]).toBe(0);
    }
  });

  it("encodes a single-symbol stream with the length-1 code", () => {
    const encoded = huffmanEncode(Uint8Array.from([42, 42, 42]));
    expect(encoded.bitLength).toBe(3);
    expect(Array.from(encoded.bits)).toEqual([0b00000000]);
    expect(Array.from(huffmanDecode(encoded.bits, encoded.bitLength, encoded.codebook))).toEqual([
      42, 42, 42,
    ]);
  });

  it("never mutates the input and returns fresh arrays", () => {
    const input = Uint8Array.from([1, 1, 2, 3, 3, 3]);
    const inputCopy = Uint8Array.from(input);
    const encoded = huffmanEncode(input);
    expect(Array.from(input)).toEqual(Array.from(inputCopy));
    expect(encoded.bits).not.toBe(input);
  });

  it("encodes the same input twice to byte-identical output (Review Focus 2)", () => {
    for (const bytes of [
      ABRA_TEXT,
      mulberryBytes(3, 3000),
      new Uint8Array(1000).fill(0x7f),
      fibonacciBytes(),
    ]) {
      const encodedA = huffmanEncode(bytes);
      const encodedB = huffmanEncode(bytes);
      expect(Array.from(encodedA.bits)).toEqual(Array.from(encodedB.bits));
      expect(encodedA.bitLength).toBe(encodedB.bitLength);
      expect(Array.from(encodedA.codebook.codeLengths)).toEqual(
        Array.from(encodedB.codebook.codeLengths),
      );
    }
  });
});

describe("huffman round-trips (bit-exact)", () => {
  it("round-trips the pinned adversarial set", { timeout: 24000 }, () => {
    expectRoundTripBitExact(new Uint8Array(100000), "all-zero 1e5");
    expectRoundTripBitExact(
      Uint8Array.from({ length: 20000 }, (_, index) => (index % 2 === 0 ? 0x00 : 0xff)),
      "alternating 0x00/0xFF",
    );
    expectRoundTripBitExact(
      Uint8Array.from({ length: 1000 }, () => 0xff),
      "all 0xFF",
    );
    expectRoundTripBitExact(Uint8Array.from([0x00, 0xff, 0x00, 0xff, 0x00]), "0x00/0xFF edges");
    expectRoundTripBitExact(Uint8Array.from([10]), "single byte");
    expectRoundTripBitExact(new Uint8Array(200000).fill(0x55), "one long run 200000");
    expectRoundTripBitExact(mulberryBytes(7, 10000), "mulberry32 seed 7, 1e4");
    expectRoundTripBitExact(fibonacciBytes(), "Fibonacci-skew fallback histogram");
  });

  it("keeps a full-uniform stream the same size (padding = 8 bits per byte)", () => {
    const input = Uint8Array.from({ length: 4096 }, (_, index) => index % 256);
    const encoded = huffmanEncode(input);
    expect(encoded.bitLength).toBe(8 * input.length);
    // Uniform codebook: every codeword is its own byte, so the packed
    // stream equals the input byte for byte (zero padding bits needed).
    expect(encoded.bits).toHaveLength(input.length);
    expect(Array.from(encoded.bits)).toEqual(Array.from(input));
    expect(validatePrefixFree(encoded.codebook.codeLengths)).toBe(true);
  });

  it("compresses skewed input below the entropy upper bound (property)", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const next = mulberry32(seed);
      const bytes = new Uint8Array(5000);
      for (let index = 0; index < bytes.length; index += 1) {
        // Skewed mix: uniform over 16 values, power-law tail into [0, 255].
        bytes[index] = next() < 0.8 ? Math.floor(next() * 16) : Math.floor(next() ** 3 * 256);
      }
      const encoded = huffmanEncode(bytes);
      const averageBitsPerSymbol = encoded.bitLength / bytes.length;
      const entropy = entropyBitsPerSymbol(bytes);
      expect(averageBitsPerSymbol, `seed ${seed}`).toBeLessThan(entropy + 1);
      expectRoundTripBitExact(bytes, `seed ${seed} round-trip`);
    }
  });
});

describe("huffman decode error paths (never hang)", () => {
  it("throws the pinned truncated-bitstream error mid-symbol", () => {
    // Four equally frequent symbols: every codeword is exactly 2 bits, so
    // an ODD declared bit length always leaves one codeword half-consumed.
    const encoded = huffmanEncode(Uint8Array.from([0, 1, 2, 3, 0, 1, 2, 3]));
    expect(encoded.bitLength % 2).toBe(0);
    expectExactRangeError(
      () => huffmanDecode(encoded.bits, encoded.bitLength - 1, encoded.codebook),
      "truncated bitstream",
    );
  });

  it("throws the pinned truncated-bitstream error past the buffer", () => {
    const encoded = huffmanEncode(ABRA_TEXT);
    expectExactRangeError(
      () => huffmanDecode(new Uint8Array(1), 9 * 4, encoded.codebook),
      "truncated bitstream",
    );
    expectExactRangeError(
      () => huffmanDecode(new Uint8Array(0), 1, encoded.codebook),
      "truncated bitstream",
    );
  });

  it("throws the pinned invalid-code error on a divergent walk", () => {
    // Single-symbol book: only the codeword "0" exists, so the bit "1"
    // walks past the (maximum) length 1 with no leaf in reach.
    const codebook = buildCanonicalCodes(buildHistogram(Uint8Array.from([42, 42]))).codeLengths;
    expectExactRangeError(
      () => huffmanDecode(Uint8Array.from([0b10000000]), 1, { codeLengths: codebook }),
      "invalid huffman code",
    );
  });

  it("rejects or yields different bytes for corrupted streams, never the original", () => {
    // Huffman streams are not self-authenticating, so a flipped bit either
    // hits a typed error or decodes to a different byte sequence (the parse
    // is injective: distinct valid bitstrings cannot decode to the same
    // symbols). Either outcome proves the decoder never hangs on corruption.
    for (const seed of [17, 23, 31, 37, 43]) {
      const next = mulberry32(seed);
      const original = mulberryBytes(seed, 400);
      const encoded = huffmanEncode(original);
      for (let trial = 0; trial < 20; trial += 1) {
        const corrupted = Uint8Array.from(encoded.bits);
        const position = Math.floor(next() * encoded.bitLength);
        const byteIndex = position >> 3;
        const byte = corrupted[byteIndex];
        if (byte === undefined) {
          throw new Error("corruption fixture error");
        }
        corrupted[byteIndex] = byte ^ (0x80 >> (position & 7));
        try {
          const decoded = huffmanDecode(corrupted, encoded.bitLength, encoded.codebook);
          expect(Array.from(decoded), `seed ${seed} trial ${trial}`).not.toEqual(
            Array.from(original),
          );
        } catch (error) {
          expect(error, `seed ${seed} trial ${trial}`).toBeInstanceOf(RangeError);
        }
      }
    }
  });
});

describe("huffman validatePrefixFree", () => {
  it("accepts every codebook this module builds", () => {
    for (const codes of [
      buildCanonicalCodes(new Uint32Array(256)),
      buildCanonicalCodes(buildHistogram(ABRA_TEXT)),
      buildCanonicalCodes(buildHistogram(Uint8Array.from([42]))),
      buildCanonicalCodes(buildHistogram(Uint8Array.from({ length: 512 }, (_, i) => i % 256))),
      buildCanonicalCodes(fibonacciHistogram()),
    ]) {
      expect(validatePrefixFree(codes.codeLengths)).toBe(true);
    }
  });

  it("rejects tables that violate the Kraft inequality", () => {
    expect(validatePrefixFree(Uint8Array.from([1, 1, 1]))).toBe(false); // Σ = 1.5
    expect(validatePrefixFree(Uint8Array.from([1, 1, 2, 2]))).toBe(false); // Σ = 1.5
    expect(validatePrefixFree(Uint8Array.from([1, 1, 1, 1]))).toBe(false); // Σ = 2
  });

  it("accepts incomplete but decodable tables", () => {
    expect(validatePrefixFree(Uint8Array.from([1, 2, 3, 3]))).toBe(true); // Σ = 1
    expect(validatePrefixFree(Uint8Array.from([1, 2]))).toBe(true); // Σ = 0.75
    expect(validatePrefixFree(Uint8Array.from([3, 3, 3, 3, 3]))).toBe(true); // Σ = 5/8
    expect(validatePrefixFree(new Uint8Array(256))).toBe(true); // no codes at all
    expect(validatePrefixFree(Uint8Array.from([0, 1, 1]))).toBe(true); // unused entries ignored
  });

  it("decides long foreign lengths exactly via BigInt", () => {
    expect(validatePrefixFree(Uint8Array.from([100, 100]))).toBe(true); // 2^(1−100) ≤ 1
    expect(validatePrefixFree(Uint8Array.from([100, 100, 100]))).toBe(true); // 3·2^-100 ≤ 1
    expect(validatePrefixFree(Uint8Array.from([1, 1, 100]))).toBe(false); // 1 + 2^-100 > 1
  });
});

describe("huffman guards (R14)", () => {
  it("rejects wrong types with TypeError", () => {
    expectExactTypeError(
      () => buildHistogram(asBytes("not bytes")),
      "buildHistogram: bytes must be a Uint8Array",
    );
    expectExactTypeError(
      () => buildCanonicalCodes(asBytes(new Uint8Array(4)) as unknown as Uint32Array),
      "buildCanonicalCodes: histogram must be a Uint32Array",
    );
    expectExactTypeError(
      () => huffmanEncode(asBytes([1, 2, 3])),
      "huffmanEncode: bytes must be a Uint8Array",
    );
    expectExactTypeError(
      () => huffmanDecode(asBytes("no"), 1, { codeLengths: new Uint8Array(256) }),
      "huffmanDecode: bits must be a Uint8Array",
    );
    expectExactTypeError(
      () => huffmanDecode(new Uint8Array(1), 1, asBytes({}) as unknown as HuffmanCodebook),
      "huffmanDecode: codebook.codeLengths must be a Uint8Array",
    );
    expectExactTypeError(
      () => validatePrefixFree(asBytes("no")),
      "validatePrefixFree: codeLengths must be a Uint8Array",
    );
  });

  it("rejects invalid histogram shape and codebook params with RangeError", () => {
    expectExactRangeError(
      () => buildCanonicalCodes(new Uint32Array(100)),
      "buildCanonicalCodes: histogram must have 256 bins",
    );
    expectExactRangeError(
      () => huffmanDecode(new Uint8Array(2), 8, { codeLengths: new Uint8Array(100) }),
      "huffmanDecode: codebook.codeLengths must have 256 entries",
    );
    // Corrupted (over-subscribed) length table → invalid codebook.
    expectExactRangeError(
      () => huffmanDecode(new Uint8Array(2), 8, { codeLengths: new Uint8Array(256).fill(1) }),
      "invalid huffman codebook",
    );
    for (const badLength of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectExactRangeError(
        () => huffmanDecode(new Uint8Array(4), badLength, { codeLengths: new Uint8Array(256) }),
        "huffmanDecode: bitLength must be a non-negative integer",
      );
    }
  });
});
