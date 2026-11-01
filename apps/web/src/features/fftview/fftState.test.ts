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
