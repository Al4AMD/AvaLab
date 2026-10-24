import { describe, expect, it } from "vitest";
import type { IirCoefficients } from "../../src/index.js";
import {
  applyFilter,
  biquadHighpass,
  biquadLowpass,
  biquadNotch,
  biquadPeaking,
} from "../../src/index.js";
import { asNumber, asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("iir");
const SAMPLE_RATE_HZ = 48000;

const biquadCases = golden.cases.filter((goldenCase) => goldenCase.params.design === "biquad");

type BiquadKind = "lowpass" | "highpass" | "notch" | "peaking";

function kindOf(goldenCase: GoldenCase): BiquadKind {
  const kind = goldenCase.params.type;
  if (kind !== "lowpass" && kind !== "highpass" && kind !== "notch" && kind !== "peaking") {
    throw new Error(`golden fixture biquad type is invalid: ${String(kind)}`);
  }
  return kind;
}

function designOf(goldenCase: GoldenCase): IirCoefficients {
  const frequencyHz = asNumber(goldenCase.params.frequencyHz, "params.frequencyHz");
  const q = asNumber(goldenCase.params.q, "params.q");
  const sampleRateHz = asNumber(goldenCase.params.sampleRateHz, "params.sampleRateHz");
  switch (kindOf(goldenCase)) {
    case "lowpass":
      return biquadLowpass({ frequencyHz, q, sampleRateHz });
    case "highpass":
      return biquadHighpass({ frequencyHz, q, sampleRateHz });
    case "notch":
      return biquadNotch({ frequencyHz, q, sampleRateHz });
    case "peaking":
      return biquadPeaking({
        frequencyHz,
        q,
        gainDb: asNumber(goldenCase.params.gainDb, "params.gainDb"),
        sampleRateHz,
      });
  }
}

function expectedArrayOf(goldenCase: GoldenCase, key: string): number[] {
  return asNumberArray(goldenCase.expected[key], `expected.${key}`);
}

function expectArrayClose(
  actual: Float64Array,
  expected: readonly number[],
  rtol: number,
  atol: number,
  label: string,
): void {
  expect(actual.length, `${label} length`).toBe(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    const actualValue = actual[index] ?? Number.NaN;
    const expectedValue = expected[index] ?? Number.NaN;
    const difference = Math.abs(actualValue - expectedValue);
    const allowed = Math.max(atol, rtol * Math.abs(expectedValue));
    expect(
      difference,
      `${label}[${index}]: |${actualValue} - ${expectedValue}| = ${difference} exceeds ${allowed}`,
    ).toBeLessThanOrEqual(allowed);
  }
}

/** |H(e^{jω})| in dB, evaluated directly from the coefficients. */
function magnitudeDbAt(
  { b, a }: IirCoefficients,
  frequencyHz: number,
  sampleRateHz: number,
): number {
  const omega = (2 * Math.PI * frequencyHz) / sampleRateHz;
  let numeratorRe = 0;
  let numeratorIm = 0;
  let denominatorRe = 0;
  let denominatorIm = 0;
  for (let index = 0; index < b.length; index += 1) {
    const angle = omega * index;
    numeratorRe += (b[index] ?? 0) * Math.cos(angle);
    numeratorIm -= (b[index] ?? 0) * Math.sin(angle);
  }
  for (let index = 0; index < a.length; index += 1) {
    const angle = omega * index;
    denominatorRe += (a[index] ?? 0) * Math.cos(angle);
    denominatorIm -= (a[index] ?? 0) * Math.sin(angle);
  }
  const magnitude = Math.hypot(numeratorRe, numeratorIm) / Math.hypot(denominatorRe, denominatorIm);
  return 20 * Math.log10(magnitude);
}

describe("biquad fixture", () => {
  it("loads the analytic cookbook golden cases", () => {
    expect(biquadCases.map((goldenCase) => goldenCase.name)).toEqual([
      "biquad_lowpass_fc1000_q0.7071_fs48000",
      "biquad_highpass_fc4000_q0.7071_fs48000",
      "biquad_notch_fc1000_q1_fs48000",
      "biquad_peaking_fc2000_q1_gain6_fs48000",
      "biquad_peaking_fc2000_q1_gain12_fs48000",
    ]);
  });

  it("pins the analytic coefficient tolerance rtol = 1e-12", () => {
    for (const goldenCase of biquadCases) {
      expect(goldenCase.tolerance.rtol).toBe(1e-12);
    }
  });

  it.each(biquadCases)("matches the cookbook coefficients for $name", (goldenCase: GoldenCase) => {
    const actual = designOf(goldenCase);
    expectArrayClose(
      actual.b,
      expectedArrayOf(goldenCase, "b"),
      goldenCase.tolerance.rtol,
      goldenCase.tolerance.atol,
      `${goldenCase.name} b`,
    );
    expectArrayClose(
      actual.a,
      expectedArrayOf(goldenCase, "a"),
      goldenCase.tolerance.rtol,
      goldenCase.tolerance.atol,
      `${goldenCase.name} a`,
    );
  });

  it.each(biquadCases)("applyFilter matches scipy lfilter for $name", (goldenCase: GoldenCase) => {
    const coefficients = designOf(goldenCase);
    const input = Float64Array.from(goldenCase.input.samples);
    const filtered = applyFilter(input, coefficients);
    expectArrayClose(
      filtered,
      expectedArrayOf(goldenCase, "filteredSamples"),
      1e-12,
      1e-12,
      `${goldenCase.name} filteredSamples`,
    );
  });
});

describe("RBJ biquads", () => {
  it("normalizes a[0] to exactly 1", () => {
    const designs = [
      biquadLowpass({ frequencyHz: 1000, q: Math.SQRT1_2, sampleRateHz: SAMPLE_RATE_HZ }),
      biquadHighpass({ frequencyHz: 4000, q: Math.SQRT1_2, sampleRateHz: SAMPLE_RATE_HZ }),
      biquadNotch({ frequencyHz: 1000, q: 1, sampleRateHz: SAMPLE_RATE_HZ }),
      biquadPeaking({
        frequencyHz: 2000,
        q: 1,
        gainDb: 12,
        sampleRateHz: SAMPLE_RATE_HZ,
      }),
    ];
    for (const { a } of designs) {
      expect(a[0]).toBe(1);
    }
  });

  it("places a peaking filter's +12 dB gain at the center frequency", () => {
    const coefficients = biquadPeaking({
      frequencyHz: 2000,
      q: 1,
      gainDb: 12,
      sampleRateHz: SAMPLE_RATE_HZ,
    });
    const gainDb = magnitudeDbAt(coefficients, 2000, SAMPLE_RATE_HZ);
    expect(Math.abs(gainDb - 12)).toBeLessThanOrEqual(0.05);
  });

  it("attenuates a notch by at least 40 dB at the center frequency", () => {
    const coefficients = biquadNotch({
      frequencyHz: 1000,
      q: 1,
      sampleRateHz: SAMPLE_RATE_HZ,
    });
    const gainDb = magnitudeDbAt(coefficients, 1000, SAMPLE_RATE_HZ);
    expect(gainDb).toBeLessThanOrEqual(-40);
  });

  it("rejects frequencies outside (0, fs/2)", () => {
    for (const frequencyHz of [0, -1, 24000, 30000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        biquadLowpass({ frequencyHz, q: Math.SQRT1_2, sampleRateHz: SAMPLE_RATE_HZ }),
      ).toThrow(RangeError);
    }
  });

  it("rejects non-positive or non-finite Q and invalid sample rates", () => {
    for (const q of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => biquadHighpass({ frequencyHz: 1000, q, sampleRateHz: SAMPLE_RATE_HZ })).toThrow(
        RangeError,
      );
    }
    for (const sampleRateHz of [0, -48000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => biquadLowpass({ frequencyHz: 1000, q: 1, sampleRateHz })).toThrow(RangeError);
    }
  });

  it("rejects a non-finite gain for the peaking filter", () => {
    for (const gainDb of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() =>
        biquadPeaking({
          frequencyHz: 2000,
          q: 1,
          gainDb,
          sampleRateHz: SAMPLE_RATE_HZ,
        }),
      ).toThrow(RangeError);
    }
  });

  it("returns fresh coefficient arrays on every call", () => {
    const options = { frequencyHz: 1000, q: Math.SQRT1_2, sampleRateHz: SAMPLE_RATE_HZ };
    const first = biquadLowpass(options);
    const second = biquadLowpass(options);
    expect(first.b).not.toBe(second.b);
    expect(first.a).not.toBe(second.a);
    expect(Array.from(first.b)).toEqual(Array.from(second.b));
    expect(Array.from(first.a)).toEqual(Array.from(second.a));
  });
});
