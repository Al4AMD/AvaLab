import { describe, expect, it } from "vitest";
import { mulberry32, rleDecode, rleEncode } from "../../src/index.js";
import { asNumber, asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("rle");

function expectedEncodedOf(goldenCase: GoldenCase): Uint8Array {
  return Uint8Array.from(
    asNumberArray(goldenCase.expected.encodedBytes, `expected.encodedBytes of ${goldenCase.name}`),
  );
}

/**
 * `rle_zeros_70000_split` stores a constant input as `params` (`lengthBytes` x
 * `byteValue`) instead of ~0.5 MB of identical floats — both languages
 * reconstruct the identical bytes deterministically (see the golden
 * docstring). All other cases store the full byte list.
 */
function inputBytesOf(goldenCase: GoldenCase): Uint8Array {
  const byteValue = goldenCase.params.byteValue;
  const lengthBytes = goldenCase.params.lengthBytes;
  if (byteValue !== undefined && lengthBytes !== undefined) {
    const length = asNumber(lengthBytes, `params.lengthBytes of ${goldenCase.name}`);
    const byte = asNumber(byteValue, `params.byteValue of ${goldenCase.name}`);
    return new Uint8Array(length).fill(byte);
  }
  return Uint8Array.from(
    asNumberArray(goldenCase.input.samples, `input.samples of ${goldenCase.name}`),
  );
}

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
  expect(Array.from(rleDecode(rleEncode(bytes))), label).toEqual(Array.from(bytes));
}

/** Pins an exact RangeError instance and message (R5: exact error strings). */
function expectExactRangeError(encode: () => unknown, message: string): void {
  let caught: Error | undefined;
  try {
    encode();
  } catch (error) {
    caught = error as Error;
  }
  expect(caught, `expected RangeError("${message}")`).toBeInstanceOf(RangeError);
  expect(caught?.message, `expected RangeError("${message}")`).toBe(message);
}

describe("rle golden", () => {
  it("loads the committed rle fixture with the pinned cases", () => {
    expect(golden.algorithm).toBe("rle");
    expect(golden.cases.map((goldenCase) => goldenCase.name)).toEqual([
      "rle_empty",
      "rle_single_byte_7",
      "rle_zeros_70000_split",
      "rle_alternating_100",
      "rle_ramp_256",
      "rle_random_runs_seed7",
    ]);
  });

  for (const goldenCase of golden.cases) {
    it(`matches the golden stream byte-exactly in both directions for ${goldenCase.name}`, () => {
      const input = inputBytesOf(goldenCase);
      const expectedEncoded = expectedEncodedOf(goldenCase);
      expect(Array.from(rleEncode(input)), `${goldenCase.name} encode`).toEqual(
        Array.from(expectedEncoded),
      );
      expect(Array.from(rleDecode(expectedEncoded)), `${goldenCase.name} decode`).toEqual(
        Array.from(input),
      );
    });
  }
});

describe("rle pinned byte layout", () => {
  it("encodes a single byte as [value, countLo, countHi] little-endian", () => {
    expect(Array.from(rleEncode(Uint8Array.from([7])))).toEqual([7, 1, 0]);
    expect(Array.from(rleEncode(Uint8Array.from([0])))).toEqual([0, 1, 0]);
    expect(Array.from(rleEncode(Uint8Array.from([255])))).toEqual([255, 1, 0]);
  });

  it("encodes long runs as greedy 65535 records plus the remainder", () => {
    // 70000 times 0 -> 0,255,255 (count 0xFFFF) then 0,113,17 (count 0x1171).
    const zeros70000 = new Uint8Array(70000);
    expect(Array.from(rleEncode(zeros70000))).toEqual([0, 255, 255, 0, 113, 17]);

    // Exactly 65535 identical bytes stay in one record; one more byte splits.
    const run65535 = new Uint8Array(65535).fill(9);
    expect(rleEncode(run65535)).toHaveLength(3);
    const run65536 = new Uint8Array(65536).fill(9);
    const split = Array.from(rleEncode(run65536));
    expect(split).toEqual([...Array.from(rleEncode(run65535)), 9, 1, 0]);
    expect(split).toHaveLength(6);
  });

  it("decodes the maximum count 65535 exactly", () => {
    const decoded = rleDecode(Uint8Array.from([9, 255, 255]));
    expect(decoded).toHaveLength(65535);
    for (const byte of decoded) {
      expect(byte).toBe(9);
    }
  });
});

describe("rle adversarial round-trips (bit-exact)", () => {
  it("round-trips the pinned adversarial set", () => {
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
  });
});

describe("rle compression sanity", () => {
  it("shrinks runs-heavy input and expands random input (documented expansion)", () => {
    // 2100 runs of 100 identical bytes -> one 3-byte record per run.
    const runsHeavy = new Uint8Array(2100 * 100);
    for (let runIndex = 0; runIndex < 2100; runIndex += 1) {
      runsHeavy.fill(runIndex % 256, runIndex * 100, (runIndex + 1) * 100);
    }
    const encodedRuns = rleEncode(runsHeavy);
    expect(encodedRuns).toHaveLength(2100 * 3);
    expect(encodedRuns.length).toBeLessThan(runsHeavy.length);

    // Noise has almost no equal-neighbour runs, so cost goes from 1 byte to
    // 3-byte records: RLE on random data expands by ~3x (documented here and
    // in ALGORITHMS.md, motivating the Huffman/delta codecs of this wave).
    const randomBytes = mulberryBytes(7, 10000);
    const encodedRandom = rleEncode(randomBytes);
    expect(encodedRandom.length).toBeGreaterThan(randomBytes.length);
  });
});

describe("rle guards", () => {
  it("round-trips empty input to empty output (R5)", () => {
    expect(rleEncode(new Uint8Array(0))).toHaveLength(0);
    expect(rleDecode(new Uint8Array(0))).toHaveLength(0);
  });

  it("throws the pinned truncated-stream error for non-multiple-of-3 lengths", () => {
    for (const bytes of [
      Uint8Array.from([7]),
      Uint8Array.from([7, 1]),
      Uint8Array.from([7, 1, 0, 9]),
      Uint8Array.from([7, 1, 0, 9, 0]),
    ]) {
      expect(() => rleDecode(bytes)).toThrow(RangeError);
      expectExactRangeError(() => rleDecode(bytes), "truncated rle stream");
    }
  });

  it("throws the pinned count-0 error for a zero count word", () => {
    expectExactRangeError(() => rleDecode(Uint8Array.from([7, 0, 0])), "invalid rle count 0");
    expectExactRangeError(
      () => rleDecode(Uint8Array.from([7, 1, 0, 9, 0, 0])),
      "invalid rle count 0",
    );
  });

  it("does not mutate the input and returns fresh arrays", () => {
    const input = Uint8Array.from([1, 1, 2, 3, 3, 3]);
    const inputCopy = Uint8Array.from(input);
    const encoded = rleEncode(input);
    expect(Array.from(input)).toEqual(Array.from(inputCopy));
    expect(encoded).not.toBe(input);
    const encodedCopy = Uint8Array.from(encoded);
    const decoded = rleDecode(encoded);
    expect(Array.from(encoded)).toEqual(Array.from(encodedCopy));
    expect(decoded).not.toBe(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(input));
  });
});
