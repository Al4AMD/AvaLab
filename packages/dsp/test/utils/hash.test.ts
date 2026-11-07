/**
 * inputHash64 tests. The expectation is computed with an inline BigInt
 * reference (independent of the production Math.imul loop) and a few pinned
 * outputs guard the algorithm choice. The hash is a two-lane FNV-1a-32
 * fingerprint over sample words with MurmurHash3 fmix32 finalizers; it is NOT
 * the published byte-wise FNV-1a-64 and makes no cryptographic claim.
 */
import { describe, expect, it } from "vitest";
import { inputHash64, inputHash64Channels } from "../../src/index.js";

/** Straightforward BigInt two-lane reference (one iteration per word). */
function hash64Reference(words: Uint32Array): string {
  let laneA = 0x811c9dc5n;
  let laneB = 0x9e3779b9n;
  const mask = 0xffffffffn;
  const fmix = (value: bigint): bigint => {
    let hash = value;
    hash ^= hash >> 16n;
    hash = (hash * 0x85ebca6bn) & mask;
    hash ^= hash >> 13n;
    hash = (hash * 0xc2b2ae35n) & mask;
    hash ^= hash >> 16n;
    return hash;
  };
  for (let index = 0; index < words.length; index += 1) {
    const word: number | undefined = words[index];
    if (word === undefined) {
      throw new RangeError(`hash64Reference: words[${index}] read out of bounds`);
    }
    laneA = ((laneA ^ BigInt(word)) * 0x01000193n) & mask;
    laneB = ((laneB ^ BigInt(word)) * 0x9e3779b1n) & mask;
  }
  return `${fmix(laneA).toString(16).padStart(8, "0")}${fmix(laneB).toString(16).padStart(8, "0")}`;
}

function wordsOf(samples: Float32Array): Uint32Array {
  return new Uint32Array(samples.buffer, samples.byteOffset, samples.length);
}

function samplesWithWords(words: number[]): Float32Array {
  const samples = new Float32Array(words.length);
  const view = new Uint32Array(samples.buffer);
  for (let index = 0; index < words.length; index += 1) {
    const word: number | undefined = words[index];
    if (word === undefined) {
      throw new RangeError(`samplesWithWords: words[${index}] read out of bounds`);
    }
    view[index] = word;
  }
  return samples;
}

describe("inputHash64", () => {
  it("matches the inline reference on seeded random Float32 data at several lengths", () => {
    let state = 0x5eed1234;
    const nextRandom = (): number => {
      state = (1664525 * state + 1013904223) >>> 0;
      return state;
    };
    for (const sampleCount of [0, 1, 2, 3, 17, 257, 4096]) {
      const samples = new Float32Array(sampleCount);
      for (let index = 0; index < sampleCount; index += 1) {
        samples[index] = (Number((nextRandom() % 65536) - 32768) / 32768) * 0.25;
      }
      expect(inputHash64(samples)).toBe(hash64Reference(wordsOf(samples)));
    }
  });

  it("pins the empty and simple-word outputs", () => {
    expect(inputHash64(new Float32Array(0))).toBe("ab3e7c0b92ca2f0e");
    expect(inputHash64(samplesWithWords([0x3f800000]))).toBe("51b59520b0d70fa9");
    expect(inputHash64(samplesWithWords([0x3f800000, 0xc0000000, 0x3f000000]))).toBe(
      "372085c8cee1f3f0",
    );
  });

  it("hashes the view's own subrange: a subarray view equals a fresh array of the same samples", () => {
    const base = new Float32Array([1.5, -2.5, 0.25, 7]);
    const fresh = new Float32Array([-2.5, 0.25, 7]);
    expect(inputHash64(base.subarray(1))).toBe(inputHash64(fresh));
    expect(inputHash64(base)).not.toBe(inputHash64(base.subarray(1)));
  });

  it("hashes -0 and +0 distinctly (documented bit-pattern decision)", () => {
    expect(inputHash64(new Float32Array([-0]))).not.toBe(inputHash64(new Float32Array([0])));
  });

  it("hashes NaN and denormal bit patterns deterministically without value canonicalization", () => {
    const denormal = new Float32Array([2 ** -149]);
    const nan = new Float32Array([Number.NaN]);
    expect(inputHash64(denormal)).toBe(hash64Reference(wordsOf(denormal)));
    expect(inputHash64(nan)).toBe(hash64Reference(wordsOf(nan)));
    expect(inputHash64(denormal)).not.toBe(inputHash64(new Float32Array([0])));
  });

  it("is deterministic: the same input hashes twice to the same value", () => {
    const samples = new Float32Array([0.1, -0.9, 4.5, 1e-20]);
    expect(inputHash64(samples)).toBe(inputHash64(samples));
  });

  it("never mutates the input (word-exact comparison against a deep copy)", () => {
    const samples = new Float32Array([0.25, -3.75, 12.5, -0.75, 1e-30]);
    const copy = samples.slice();
    inputHash64(samples);
    expect([...wordsOf(samples)]).toEqual([...wordsOf(copy)]);
  });

  it("diffusion: every single flipped sample bit changes the hash; mean differing bits near half", () => {
    const popcount64 = (value: bigint): number => {
      let count = 0;
      for (let bit = 0; bit < 64; bit += 1) {
        if ((value & (1n << BigInt(bit))) !== 0n) {
          count += 1;
        }
      }
      return count;
    };
    const probe = (dataset: Float32Array): { meanBits: number } => {
      const base = BigInt(`0x${inputHash64(dataset)}`);
      const words = wordsOf(dataset);
      let differingBitsTotal = 0;
      for (let query = 0; query < 100; query += 1) {
        const wordIndex = query % dataset.length;
        const bitIndex = (query * 7) % 32;
        const original = words[wordIndex];
        if (original === undefined) {
          throw new Error(`diffusion test: no word at ${String(wordIndex)}`);
        }
        words[wordIndex] = original ^ (1 << bitIndex);
        const flipped = BigInt(`0x${inputHash64(dataset)}`);
        words[wordIndex] = original;
        const differingBits = popcount64(base ^ flipped);
        expect(differingBits).toBeGreaterThanOrEqual(1);
        differingBitsTotal += differingBits;
      }
      return { meanBits: differingBitsTotal / 100 };
    };

    let seed = 0x2f6e2b1;
    const nextRandom = (): number => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed;
    };
    const datasets = [1024, 4096].map((length) => {
      const dataset = new Float32Array(length);
      for (let index = 0; index < length; index += 1) {
        dataset[index] =
          Math.sin((2 * Math.PI * 440 * index) / 48000) * 0.5 +
          (Number(nextRandom() % 2001) - 1000) / 100000;
      }
      return dataset;
    });
    for (const dataset of datasets) {
      const { meanBits } = probe(dataset);
      expect(meanBits).toBeGreaterThanOrEqual(24);
      expect(meanBits).toBeLessThanOrEqual(40);
    }
  });
});

describe("inputHash64Channels", () => {
  it("delegates a single channel to inputHash64 byte-for-byte", () => {
    for (const samples of [
      new Float32Array(0),
      new Float32Array([0, 0.5, -1]),
      new Float32Array([0.1, -0.9, 4.5, 1e-20]),
    ]) {
      expect(inputHash64Channels([samples])).toBe(inputHash64(samples));
    }
  });

  it("is sensitive to the right channel and channel count", () => {
    const left = new Float32Array([0.25, -0.5, 0.75]);
    const right = new Float32Array([-0.25, 0.5, -0.75]);
    const stereo = inputHash64Channels([left, right]);
    expect(stereo).toBe(inputHash64Channels([left, right.slice()]));
    expect(stereo).not.toBe(inputHash64Channels([left, new Float32Array(right.length)]));
    expect(stereo).not.toBe(inputHash64Channels([new Float32Array([...left, ...right])]));
    expect(stereo).toMatch(/^[0-9a-f]{16}$/);
  });

  it("rejects bad channel counts, non-Float32 lanes, and uneven lengths", () => {
    expect(() => inputHash64Channels([])).toThrow(RangeError);
    expect(() =>
      inputHash64Channels([new Float32Array(1), new Float32Array(1), new Float32Array(1)]),
    ).toThrow(RangeError);
    expect(() =>
      inputHash64Channels([new Float32Array(1), [1] as unknown as Float32Array]),
    ).toThrow(TypeError);
    expect(() => inputHash64Channels([new Float32Array(1), new Float32Array(2)])).toThrow(
      RangeError,
    );
  });

  it("never mutates either channel", () => {
    const left = new Float32Array([0.25, -3.75, 12.5]);
    const right = new Float32Array([1.5, -2.5, 0.25]);
    const leftCopy = left.slice();
    const rightCopy = right.slice();
    inputHash64Channels([left, right]);
    expect(left).toEqual(leftCopy);
    expect(right).toEqual(rightCopy);
  });
});
