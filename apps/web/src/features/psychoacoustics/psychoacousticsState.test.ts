import { describe, expect, it } from "vitest";

import {
  PSYCHOACOUSTICS_DEFAULT_SETTINGS,
  PSYCHOACOUSTICS_REFERENCE_DEFAULT,
  PSYCHOACOUSTICS_REFERENCE_MAX,
  PSYCHOACOUSTICS_REFERENCE_MIN,
  psychoacousticsAnalysisRange,
  psychoacousticsSettingsFromSearch,
  psychoacousticsSettingsToSearch,
} from "./psychoacousticsState";

describe("psychoacoustics URL state", () => {
  it("round-trips all fields", () => {
    const settings = {
      referenceSplDb: 88,
      frequencyScale: "linear" as const,
      showThreshold: false,
    };
    const search = psychoacousticsSettingsToSearch(settings);
    expect(search).toContain("rspl=88");
    expect(search).toContain("fs=linear");
    expect(search).toContain("th=0");
    expect(psychoacousticsSettingsFromSearch(`?${search}`)).toEqual(settings);
  });

  it("defaults to log scale and a visible threshold", () => {
    expect(psychoacousticsSettingsFromSearch("")).toEqual(PSYCHOACOUSTICS_DEFAULT_SETTINGS);
    expect(PSYCHOACOUSTICS_DEFAULT_SETTINGS.referenceSplDb).toBe(PSYCHOACOUSTICS_REFERENCE_DEFAULT);
    expect(PSYCHOACOUSTICS_DEFAULT_SETTINGS.frequencyScale).toBe("log");
    expect(PSYCHOACOUSTICS_DEFAULT_SETTINGS.showThreshold).toBe(true);
  });

  it("falls back per field for invalid values", () => {
    const settings = psychoacousticsSettingsFromSearch("?rspl=nope&fs=wat&th=wat");
    expect(settings.referenceSplDb).toBe(PSYCHOACOUSTICS_REFERENCE_DEFAULT);
    expect(settings.frequencyScale).toBe("log");
    expect(settings.showThreshold).toBe(true);
  });

  it("clamps the reference SPL", () => {
    expect(psychoacousticsSettingsFromSearch("?rspl=40").referenceSplDb).toBe(
      PSYCHOACOUSTICS_REFERENCE_MIN,
    );
    expect(psychoacousticsSettingsFromSearch("?rspl=140").referenceSplDb).toBe(
      PSYCHOACOUSTICS_REFERENCE_MAX,
    );
    expect(psychoacousticsSettingsFromSearch("?rspl=93.6").referenceSplDb).toBe(94);
  });
});

describe("psychoacoustics analysis range", () => {
  it("keeps a real sub-selection", () => {
    expect(
      psychoacousticsAnalysisRange({ startSample: 100, endSample: 200 }, 10_000, 48_000),
    ).toEqual({ startSample: 100, endSample: 200 });
  });

  it("uses the first 30 seconds when the selection is the whole source", () => {
    expect(
      psychoacousticsAnalysisRange({ startSample: 0, endSample: 3_840_000 }, 3_840_000, 96_000),
    ).toEqual({ startSample: 0, endSample: 30 * 96_000 });
  });

  it("handles an empty source", () => {
    expect(psychoacousticsAnalysisRange({ startSample: 0, endSample: 0 }, 0, 48_000)).toEqual({
      startSample: 0,
      endSample: 0,
    });
  });
});
