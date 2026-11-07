import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  encodeWavPcm16,
  generateSine,
  kWeightingCoefficients,
  loudnessGainDb,
  measureLoudness,
} from "../../src/index.js";
import { asNumber, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("loudness");

function goldenCaseNamed(name: string): GoldenCase {
  const found = golden.cases.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`fixture is missing case "${name}"`);
  }
  return found;
}

function sine(sampleRateHz: number, amplitude: number, durationSeconds: number): Float32Array {
  return Float32Array.from(
    generateSine({ sampleRateHz, frequencyHz: 1000, amplitude, durationSeconds }),
  );
}

function expectedBlocks(goldenCase: GoldenCase): Record<string, unknown>[] {
  const blocks = goldenCase.expected.blocks;
  if (!Array.isArray(blocks)) {
    throw new Error(`expected.blocks of ${goldenCase.name} is not an array`);
  }
  return blocks.map((block, index) => {
    if (typeof block !== "object" || block === null || Array.isArray(block)) {
      throw new Error(`expected.blocks[${index}] of ${goldenCase.name} is not an object`);
    }
    return block as Record<string, unknown>;
  });
}

function expectFiniteClose(
  actual: number,
  expected: number,
  tolerance: number,
  label: string,
): void {
  expect(Number.isFinite(actual), `${label} is not finite`).toBe(true);
  expect(Math.abs(actual - expected), `${label}: |${actual} - ${expected}|`).toBeLessThanOrEqual(
    tolerance,
  );
}

describe("loudness fixture", () => {
  it("loads the committed loudness fixture with the pinned cases", () => {
    expect(golden.algorithm).toBe("loudness");
    expect(golden.cases.map((goldenCase) => goldenCase.name)).toEqual([
      "loudness_sine_1k_minus20_48k",
      "loudness_sine_1k_minus20_44k1",
      "loudness_sine_1k_minus20_96k",
      "loudness_silence_48k",
      "loudness_two_level_48k",
    ]);
  });

  it("pins 1e-6 absolute agreement for finite values", () => {
    for (const goldenCase of golden.cases) {
      expect(goldenCase.tolerance.rtol).toBe(1e-6);
      expect(goldenCase.tolerance.atol).toBe(1e-6);
    }
  });
});

describe("measureLoudness (golden)", () => {
  it("matches the 48 kHz sine reference block-for-block", () => {
    const goldenCase = goldenCaseNamed("loudness_sine_1k_minus20_48k");
    const actual = measureLoudness(Float32Array.from(goldenCase.input.samples), {
      sampleRateHz: goldenCase.input.sample_rate_hz ?? 48000,
    });
    expectFiniteClose(
      actual.integratedLufs,
      asNumber(goldenCase.expected.integratedLufs, "integratedLufs"),
      1e-6,
      "integrated",
    );
    const blocks = expectedBlocks(goldenCase);
    expect(actual.blocks.length).toBe(blocks.length);
    for (let index = 0; index < blocks.length; index += 1) {
      const expected = blocks[index] ?? {};
      const block = actual.blocks[index];
      if (block === undefined) {
        throw new Error(`missing block ${index}`);
      }
      expect(block.startSample).toBe(asNumber(expected.startSample, "block.startSample"));
      expectFiniteClose(
        block.loudnessLufs,
        asNumber(expected.loudnessLufs, "block.loudnessLufs"),
        1e-6,
        `block[${index}].loudnessLufs`,
      );
      expect(block.absoluteGated).toBe(expected.absoluteGated);
      expect(block.relativeGated).toBe(expected.relativeGated);
    }
    expect(actual.blockDurationSeconds).toBe(0.4);
    expect(actual.blockHopSeconds).toBe(0.1);
  });

  it("matches the 44.1 kHz reference (no interpolation of the 48 kHz coefficients)", () => {
    const goldenCase = goldenCaseNamed("loudness_sine_1k_minus20_44k1");
    const actual = measureLoudness(Float32Array.from(goldenCase.input.samples), {
      sampleRateHz: 44100,
    });
    expectFiniteClose(
      actual.integratedLufs,
      asNumber(goldenCase.expected.integratedLufs, "integratedLufs"),
      1e-6,
      "integrated 44.1k",
    );
  });

  it("matches the 96 kHz reference", () => {
    const goldenCase = goldenCaseNamed("loudness_sine_1k_minus20_96k");
    const actual = measureLoudness(Float32Array.from(goldenCase.input.samples), {
      sampleRateHz: 96000,
    });
    expectFiniteClose(
      actual.integratedLufs,
      asNumber(goldenCase.expected.integratedLufs, "integratedLufs"),
      1e-6,
      "integrated 96k",
    );
  });

  it("returns -Infinity for silence but still reports finite blocks", () => {
    const goldenCase = goldenCaseNamed("loudness_silence_48k");
    const actual = measureLoudness(Float32Array.from(goldenCase.input.samples), {
      sampleRateHz: 48000,
    });
    expect(actual.integratedLufs).toBe(Number.NEGATIVE_INFINITY);
    expect(actual.blocks.length).toBe(asNumber(goldenCase.expected.blockCount, "blockCount"));
    expect(actual.blocks.every((block) => block.loudnessLufs === Number.NEGATIVE_INFINITY)).toBe(
      true,
    );
    expect(actual.blocks.every((block) => block.absoluteGated)).toBe(false);
  });

  it("excludes blocks 15 LU below the loud block via the relative gate", () => {
    const goldenCase = goldenCaseNamed("loudness_two_level_48k");
    const actual = measureLoudness(Float32Array.from(goldenCase.input.samples), {
      sampleRateHz: 48000,
    });
    const blocks = expectedBlocks(goldenCase);
    expect(actual.blocks.length).toBe(blocks.length);
    const quietIndex = blocks.findIndex((block) => block.relativeGated === false);
    expect(quietIndex).toBeGreaterThanOrEqual(0);
    const quiet = actual.blocks[quietIndex];
    if (quiet === undefined) {
      throw new Error("missing quiet block");
    }
    expect(quiet.absoluteGated).toBe(true);
    expect(quiet.relativeGated).toBe(false);
    expectFiniteClose(
      quiet.loudnessLufs,
      asNumber(blocks[quietIndex]?.loudnessLufs, "quiet loudnessLufs"),
      1e-6,
      "quiet block",
    );
    expectFiniteClose(
      actual.integratedLufs,
      asNumber(goldenCase.expected.integratedLufs, "integratedLufs"),
      1e-6,
      "gated integrated",
    );
  });
});

describe("measureLoudness (known level)", () => {
  it("measures a mono 1 kHz -20 dBFS RMS sine within 0.5 LU of -20", () => {
    const result = measureLoudness(sine(48000, Math.SQRT2 * 0.1, 1), { sampleRateHz: 48000 });
    expect(Math.abs(result.integratedLufs - -20)).toBeLessThanOrEqual(0.5);
  });

  it("uses 400 ms blocks with 100 ms hops and ignores trailing samples", () => {
    const result = measureLoudness(sine(48000, 0.1, 1.05), { sampleRateHz: 48000 });
    expect(result.blockDurationSeconds).toBe(0.4);
    expect(result.blockHopSeconds).toBe(0.1);
    expect(result.blocks.map((block) => block.startSample)).toEqual([
      0, 4800, 9600, 14400, 19200, 24000, 28800,
    ]);
    expect(result.blocks.every((block) => block.durationSeconds === 0.4)).toBe(true);
  });

  it("returns no blocks when the input is shorter than one block", () => {
    const result = measureLoudness(sine(48000, 0.1, 0.39), { sampleRateHz: 48000 });
    expect(result.blocks).toEqual([]);
    expect(result.integratedLufs).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("kWeightingCoefficients", () => {
  it("returns the exact BS.1770 48 kHz coefficients", () => {
    const coefficients = kWeightingCoefficients(48000);
    expect(Array.from(coefficients.shelf.b)).toEqual([
      1.53512485958697, -2.69169618940638, 1.19839281085285,
    ]);
    expect(Array.from(coefficients.shelf.a)).toEqual([1, -1.69065929318241, 0.73248077421585]);
    expect(Array.from(coefficients.highpass.b)).toEqual([1, -2, 1]);
    expect(Array.from(coefficients.highpass.a)).toEqual([1, -1.99004745483398, 0.99007225036621]);
  });

  it("derives finite, normalized coefficients at other rates", () => {
    for (const sampleRateHz of [44100, 8000, 96000]) {
      const coefficients = kWeightingCoefficients(sampleRateHz);
      for (const value of [
        ...coefficients.shelf.b,
        ...coefficients.shelf.a,
        ...coefficients.highpass.b,
        ...coefficients.highpass.a,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(coefficients.shelf.a[0]).toBe(1);
      expect(coefficients.highpass.a[0]).toBe(1);
    }
  });

  it("rejects invalid rates", () => {
    for (const sampleRateHz of [0, -48000, Number.NaN, Number.POSITIVE_INFINITY, 96001]) {
      expect(() => kWeightingCoefficients(sampleRateHz)).toThrow(RangeError);
    }
  });
});

describe("measureLoudness validation", () => {
  it("rejects an empty input, invalid rate, and non-finite samples", () => {
    expect(() => measureLoudness(new Float32Array(0), { sampleRateHz: 48000 })).toThrow(RangeError);
    expect(() => measureLoudness(new Float32Array(4), { sampleRateHz: 0 })).toThrow(RangeError);
    expect(() =>
      measureLoudness(Float32Array.from([0, Number.NaN]), { sampleRateHz: 48000 }),
    ).toThrow(TypeError);
    expect(() =>
      measureLoudness(Float32Array.from([0, Number.POSITIVE_INFINITY]), { sampleRateHz: 48000 }),
    ).toThrow(TypeError);
  });
});

describe("loudnessGainDb", () => {
  it("returns original minus processed and clamps to ±24 dB", () => {
    expect(loudnessGainDb(-20, -23)).toBe(3);
    expect(loudnessGainDb(-20, -50)).toBe(24);
    expect(loudnessGainDb(-50, -20)).toBe(-24);
  });

  it("returns 0 for non-finite inputs", () => {
    expect(loudnessGainDb(Number.NEGATIVE_INFINITY, -20)).toBe(0);
    expect(loudnessGainDb(-20, Number.NaN)).toBe(0);
    expect(loudnessGainDb(Number.POSITIVE_INFINITY, -20)).toBe(0);
  });
});

describe("measureLoudness (ffmpeg ebur128 cross-check)", () => {
  const available = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

  it.skipIf(!available)("matches ffmpeg at 44.1, 48, and 96 kHz within 0.2 LU", () => {
    const directory = mkdtempSync(join(tmpdir(), "avalab-loudness-"));
    try {
      for (const sampleRateHz of [44100, 48000, 96000]) {
        const samples = sine(sampleRateHz, Math.SQRT2 * 0.1, 1);
        const wav = encodeWavPcm16(samples, { sampleRateHz });
        const path = join(directory, `tone-${sampleRateHz}.wav`);
        writeFileSync(path, wav);

        const run = spawnSync(
          "ffmpeg",
          [
            "-hide_banner",
            "-nostats",
            "-f",
            "wav",
            "-i",
            path,
            "-filter_complex",
            "ebur128=peak=true",
            "-f",
            "null",
            "-",
          ],
          { encoding: "utf8" },
        );
        expect(run.status, run.stderr).toBe(0);
        const matches = [...run.stderr.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s+LUFS/g)];
        const reference = Number(matches.at(-1)?.[1]);
        expect(Number.isFinite(reference), "ffmpeg printed no integrated loudness").toBe(true);

        const actual = measureLoudness(samples, { sampleRateHz }).integratedLufs;
        expect(
          Math.abs(actual - reference),
          `${sampleRateHz} Hz: ${actual} vs ${reference}`,
        ).toBeLessThanOrEqual(0.2);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
