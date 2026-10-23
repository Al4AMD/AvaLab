import { describe, expect, it } from "vitest";
import type { FirBand, FirWindowFilter, FirWindowOptions } from "../../src/index.js";
import { designFirWindow } from "../../src/index.js";
import { asNumber, asNumberArray, type GoldenCase, loadGolden } from "../fixtures.js";

const golden = loadGolden("fir");

const VALID_OPTIONS: FirWindowOptions = {
  band: "lowpass",
  cutoffHz: [4000],
  taps: 31,
  sampleRateHz: 48000,
  windowFilter: { kind: "hamming" },
};

function bandOf(goldenCase: GoldenCase): FirBand {
  const band = goldenCase.params.band;
  if (band !== "lowpass" && band !== "highpass" && band !== "bandpass" && band !== "bandstop") {
    throw new Error(`golden fixture band is invalid: ${String(band)}`);
  }
  return band;
}

function windowFilterOf(goldenCase: GoldenCase): FirWindowFilter {
  const raw = goldenCase.params.windowFilter;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("golden fixture windowFilter is not an object");
  }
  const record = raw as Record<string, unknown>;
  const kind = record.kind;
  if (kind !== "hamming" && kind !== "blackman" && kind !== "kaiser") {
    throw new Error(`golden fixture window kind is invalid: ${String(kind)}`);
  }
  const beta = record.beta;
  return beta === undefined ? { kind } : { kind, beta: asNumber(beta, "windowFilter.beta") };
}

function optionsOf(goldenCase: GoldenCase): FirWindowOptions {
  return {
    band: bandOf(goldenCase),
    cutoffHz: asNumberArray(goldenCase.params.cutoffHz, "params.cutoffHz"),
    taps: asNumber(goldenCase.params.taps, "params.taps"),
    sampleRateHz: asNumber(goldenCase.params.sampleRateHz, "params.sampleRateHz"),
    windowFilter: windowFilterOf(goldenCase),
  };
}

function expectedTapsOf(goldenCase: GoldenCase): number[] {
  return asNumberArray(goldenCase.expected.taps, "expected.taps");
}

function expectTapsClose(
  actual: Float64Array,
  expected: readonly number[],
  rtol: number,
  atol: number,
  label: string,
): void {
  expect(actual.length, `${label} length`).toBe(expected.length);
  for (let n = 0; n < expected.length; n += 1) {
    const actualValue = actual[n] ?? Number.NaN;
    const expectedValue = expected[n] ?? Number.NaN;
    const difference = Math.abs(actualValue - expectedValue);
    const allowed = Math.max(atol, rtol * Math.abs(expectedValue));
    expect(
      difference,
      `${label}[${n}]: |${actualValue} - ${expectedValue}| = ${difference} exceeds ${allowed}`,
    ).toBeLessThanOrEqual(allowed);
  }
}

function expectSymmetry(taps: Float64Array, description: string): void {
  let maxDifference = 0;
  for (let n = 0; n < taps.length; n += 1) {
    const mirrored = taps[taps.length - 1 - n] ?? 0;
    maxDifference = Math.max(maxDifference, Math.abs((taps[n] ?? 0) - mirrored));
  }
  expect(maxDifference, `${description} symmetry h[n] = h[N-1-n]`).toBeLessThanOrEqual(1e-12);
}

/** Direct DTFT magnitude at `frequencyHz`; independent of the analysis module. */
function dtftMagnitudeAt(taps: Float64Array, frequencyHz: number, sampleRateHz: number): number {
  let real = 0;
  let imaginary = 0;
  for (let n = 0; n < taps.length; n += 1) {
    const angle = (2 * Math.PI * frequencyHz * n) / sampleRateHz;
    const value = taps[n] ?? 0;
    real += value * Math.cos(angle);
    imaginary -= value * Math.sin(angle);
  }
  return Math.hypot(real, imaginary);
}

describe("fir fixture", () => {
  it("loads the committed golden fixture with the pinned cases", () => {
    expect(golden.algorithm).toBe("fir");
    expect(golden.cases.map((goldenCase) => goldenCase.name)).toEqual([
      "lowpass_31_hamming_fc4000_fs48000",
      "highpass_33_hamming_fc4000_fs48000",
      "bandpass_41_blackman_fc4000_12000_fs48000",
      "bandstop_33_kaiser_beta5_fc4000_12000_fs48000",
      "lowpass_32_hamming_fc4000_fs48000_even_taps",
    ]);
  });

  it("pins rtol = 1e-9", () => {
    for (const goldenCase of golden.cases) {
      expect(goldenCase.tolerance.rtol).toBe(1e-9);
    }
  });

  it.each(golden.cases)("matches golden case $name", (goldenCase: GoldenCase) => {
    const actual = designFirWindow(optionsOf(goldenCase));
    expectTapsClose(
      actual,
      expectedTapsOf(goldenCase),
      goldenCase.tolerance.rtol,
      goldenCase.tolerance.atol,
      goldenCase.name,
    );
  });
});

describe("designFirWindow", () => {
  it("covers all four bands in the golden fixture", () => {
    const bands = new Set(golden.cases.map((goldenCase) => bandOf(goldenCase)));
    expect(bands).toEqual(new Set(["lowpass", "highpass", "bandpass", "bandstop"]));
  });

  it("produces linear-phase symmetric taps for odd and even tap counts", () => {
    for (const goldenCase of golden.cases) {
      expectSymmetry(designFirWindow(optionsOf(goldenCase)), goldenCase.name);
    }
    expectSymmetry(
      designFirWindow({
        ...VALID_OPTIONS,
        band: "bandpass",
        cutoffHz: [4000, 12000],
        taps: 40,
        windowFilter: { kind: "blackman" },
      }),
      "even-tap bandpass",
    );
  });

  it("normalizes lowpass and bandstop to unity DC gain", () => {
    const lowpass = designFirWindow(VALID_OPTIONS);
    expect(Math.abs(dtftMagnitudeAt(lowpass, 0, 48000) - 1)).toBeLessThanOrEqual(1e-12);

    const bandstop = designFirWindow({
      ...VALID_OPTIONS,
      band: "bandstop",
      cutoffHz: [4000, 12000],
      taps: 33,
      windowFilter: { kind: "kaiser", beta: 5 },
    });
    expect(Math.abs(dtftMagnitudeAt(bandstop, 0, 48000) - 1)).toBeLessThanOrEqual(1e-12);
  });

  it("normalizes highpass to unity at Nyquist and bandpass to unity at the passband centre", () => {
    const highpass = designFirWindow({
      ...VALID_OPTIONS,
      band: "highpass",
      taps: 33,
    });
    expect(Math.abs(dtftMagnitudeAt(highpass, 24000, 48000) - 1)).toBeLessThanOrEqual(1e-12);

    const bandpass = designFirWindow({
      ...VALID_OPTIONS,
      band: "bandpass",
      cutoffHz: [4000, 12000],
      taps: 41,
      windowFilter: { kind: "blackman" },
    });
    expect(Math.abs(dtftMagnitudeAt(bandpass, 8000, 48000) - 1)).toBeLessThanOrEqual(1e-12);
  });

  it("keeps the highpass DC gain at or below 1e-3 for a 65-tap design", () => {
    // The 33-tap hamming golden design already sits at -51 dB (2.76e-3);
    // 65 taps push the DC leakage below the brief's 1e-3 bound.
    const highpass = designFirWindow({ ...VALID_OPTIONS, band: "highpass", taps: 65 });
    expect(dtftMagnitudeAt(highpass, 0, 48000)).toBeLessThanOrEqual(1e-3);
  });

  it("has a half-amplitude (-6 dB) response at every design cutoff", () => {
    // firwin's cutoff is the half-amplitude point: |H(fc)| / passband gain
    // is 0.5, i.e. -6.02 dB (not the -3 dB / 1/sqrt(2) power point).
    for (const goldenCase of golden.cases) {
      const options = optionsOf(goldenCase);
      const taps = designFirWindow(options);
      const band = options.band;
      const referenceHz =
        band === "bandpass"
          ? ((options.cutoffHz[0] ?? 0) + (options.cutoffHz[1] ?? 0)) / 2
          : band === "highpass"
            ? options.sampleRateHz / 2
            : 0;
      const reference = dtftMagnitudeAt(taps, referenceHz, options.sampleRateHz);
      for (const cutoffHz of options.cutoffHz) {
        const ratio = dtftMagnitudeAt(taps, cutoffHz, options.sampleRateHz) / reference;
        expect(
          Math.abs(ratio - 0.5),
          `${goldenCase.name}: |H(${cutoffHz})|/|H(ref)| = ${ratio}, expected 0.5 +/- 0.05`,
        ).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it("uses 8.6 as the documented default kaiser beta", () => {
    const options: FirWindowOptions = {
      ...VALID_OPTIONS,
      band: "bandstop",
      cutoffHz: [4000, 12000],
      taps: 33,
      windowFilter: { kind: "kaiser" },
    };
    expect(Array.from(designFirWindow(options))).toEqual(
      Array.from(designFirWindow({ ...options, windowFilter: { kind: "kaiser", beta: 8.6 } })),
    );
  });

  it("rejects taps below 3 and non-integer taps", () => {
    for (const taps of [2, 0, -3, 3.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => designFirWindow({ ...VALID_OPTIONS, taps })).toThrow(RangeError);
    }
  });

  it("rejects a cutoff count that does not match the band", () => {
    expect(() =>
      designFirWindow({ ...VALID_OPTIONS, band: "lowpass", cutoffHz: [4000, 12000] }),
    ).toThrow(RangeError);
    expect(() => designFirWindow({ ...VALID_OPTIONS, band: "highpass", cutoffHz: [] })).toThrow(
      RangeError,
    );
    expect(() => designFirWindow({ ...VALID_OPTIONS, band: "bandpass", cutoffHz: [4000] })).toThrow(
      RangeError,
    );
    expect(() => designFirWindow({ ...VALID_OPTIONS, band: "bandstop", cutoffHz: [4000] })).toThrow(
      RangeError,
    );
  });

  it("rejects cutoffs outside (0, fs/2) or not strictly increasing", () => {
    for (const cutoffHz of [[0], [-1], [24000], [30000]]) {
      expect(() => designFirWindow({ ...VALID_OPTIONS, cutoffHz })).toThrow(RangeError);
    }
    expect(() =>
      designFirWindow({ ...VALID_OPTIONS, band: "bandpass", cutoffHz: [12000, 4000] }),
    ).toThrow(RangeError);
    expect(() =>
      designFirWindow({ ...VALID_OPTIONS, band: "bandpass", cutoffHz: [4000, 4000] }),
    ).toThrow(RangeError);
    expect(() =>
      designFirWindow({ ...VALID_OPTIONS, band: "bandpass", cutoffHz: [4000, 24000] }),
    ).toThrow(RangeError);
  });

  it("rejects non-finite design parameters", () => {
    for (const sampleRateHz of [0, -48000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => designFirWindow({ ...VALID_OPTIONS, sampleRateHz })).toThrow(RangeError);
    }
    for (const cutoff of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => designFirWindow({ ...VALID_OPTIONS, cutoffHz: [cutoff] })).toThrow(RangeError);
    }
    for (const beta of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        designFirWindow({
          ...VALID_OPTIONS,
          windowFilter: { kind: "kaiser", beta },
        }),
      ).toThrow(RangeError);
    }
  });

  it("rejects even taps for highpass and bandstop but allows them for lowpass and bandpass", () => {
    expect(() => designFirWindow({ ...VALID_OPTIONS, band: "highpass", taps: 32 })).toThrow(
      RangeError,
    );
    expect(() =>
      designFirWindow({ ...VALID_OPTIONS, band: "bandstop", cutoffHz: [4000, 12000], taps: 42 }),
    ).toThrow(RangeError);

    expect(() => designFirWindow({ ...VALID_OPTIONS, taps: 32 })).not.toThrow();
    expect(() =>
      designFirWindow({
        ...VALID_OPTIONS,
        band: "bandpass",
        cutoffHz: [4000, 12000],
        taps: 40,
      }),
    ).not.toThrow();
  });

  it("rejects unknown runtime band and window kinds", () => {
    expect(() =>
      designFirWindow({ ...VALID_OPTIONS, band: "notch" as unknown as FirBand }),
    ).toThrow(RangeError);
    expect(() =>
      designFirWindow({
        ...VALID_OPTIONS,
        windowFilter: { kind: "hann" as unknown as FirWindowFilter["kind"] },
      }),
    ).toThrow(RangeError);
  });

  it("does not mutate the cutoff array and returns a fresh array each call", () => {
    const options: FirWindowOptions = {
      ...VALID_OPTIONS,
      cutoffHz: [4000, 12000],
      band: "bandpass",
    };
    const before = [...options.cutoffHz];
    const first = designFirWindow(options);
    const second = designFirWindow(options);
    expect(options.cutoffHz).toEqual(before);
    expect(first).not.toBe(second);
    expect(Array.from(first)).toEqual(Array.from(second));
  });
});
