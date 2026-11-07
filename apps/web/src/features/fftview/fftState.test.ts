import { describe, expect, it } from "vitest";

import {
  FFT_DEFAULT_SETTINGS,
  type FftViewSettings,
  fftSettingsFromSearch,
  fftSettingsToSearch,
} from "./fftState";

describe("fft URL codec", () => {
  it("round-trips every setting", () => {
    const settings: FftViewSettings = {
      windowFamily: "blackman",
      windowLengthSamples: 4096,
      magnitudeMode: "linear",
      phaseMode: "unwrapped",
      phaseMaskDb: -35,
    };
    expect(fftSettingsFromSearch(`?${fftSettingsToSearch(settings)}`)).toEqual(settings);
  });

  it("falls back per field on malformed input", () => {
    expect(fftSettingsFromSearch("?w=bogus&n=123&m=x&p=y&mask=99")).toEqual({
      ...FFT_DEFAULT_SETTINGS,
    });
  });

  it("emits a stable key order", () => {
    expect(fftSettingsToSearch(FFT_DEFAULT_SETTINGS)).toBe("m=db&mask=-60&n=2048&p=wrapped&w=hann");
  });
});

describe("phaseMaskBins", () => {
  it("masks dB magnitudes directly", async () => {
    const { phaseMaskBins } = await import("./fftState");
    expect(
      phaseMaskBins(new Float64Array([-40, -10]), new Float64Array([1, 2]), "db", -20),
    ).toEqual([null, 2]);
  });

  it("converts linear magnitudes to dB before masking", async () => {
    const { phaseMaskBins } = await import("./fftState");
    const masked = phaseMaskBins(
      new Float64Array([0.01, 0.5]),
      new Float64Array([1, 2]),
      "linear",
      -20,
    );
    expect(masked[0]).toBeNull();
    expect(masked[1]).toBe(2);
  });

  it("never compares zero magnitude as finite dB", async () => {
    const { phaseMaskBins } = await import("./fftState");
    expect(phaseMaskBins(new Float64Array([0]), new Float64Array([1]), "linear", -120)).toEqual([
      null,
    ]);
  });
});
