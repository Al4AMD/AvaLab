/**
 * Task 3 tests: URL round-trip, edit validation, Hz→bin conversion, preset
 * replacement, Hermitian flag and the default selection/cap range.
 */
import { describe, expect, it } from "vitest";

import { FFT_MAX_LENGTH } from "../../session/ops";
import {
  binsFromHz,
  defaultSpectrumEditRange,
  presetEdits,
  SPECTRUM_EDIT_DEFAULT_SETTINGS,
  spectrumEditSettingsFromSearch,
  spectrumEditSettingsToSearch,
  validSpectrumEdit,
} from "./spectrumEditState";

describe("spectrum edit URL codec", () => {
  it("round-trips edits, Hermitian flag and range", () => {
    const settings = {
      hermitian: false,
      edits: [
        { startBin: 3, endBin: 9, target: "mag" as const, mode: "scale" as const, value: 0.5 },
        { startBin: 0, endBin: 1, target: "phase" as const, mode: "set" as const, value: 1.2 },
      ],
      startSample: 100,
      endSample: 2000,
    };
    expect(
      spectrumEditSettingsFromSearch(
        `?${spectrumEditSettingsToSearch(settings)}`,
        { sampleCount: 4000, sampleRateHz: 8000 },
        { startSample: 0, endSample: 0 },
      ),
    ).toEqual(settings);
  });

  it("falls back per field and drops malformed edits", () => {
    const settings = spectrumEditSettingsFromSearch(
      "?h=0&ed=%5B%7B%22startBin%22%3A2%7D%2C%7B%22startBin%22%3A1%2C%22endBin%22%3A4%2C%22target%22%3A%22re%22%2C%22mode%22%3A%22zero%22%2C%22value%22%3A0%7D%5D&from=x&to=-4",
      { sampleCount: 100, sampleRateHz: 8000 },
      { startSample: 0, endSample: 0 },
    );
    expect(settings.hermitian).toBe(false);
    expect(settings.edits).toEqual([
      { startBin: 1, endBin: 4, target: "re", mode: "zero", value: 0 },
    ]);
    expect(settings.startSample).toBe(0);
    expect(settings.endSample).toBe(100);
  });

  it("emits a stable key order and the h flag", () => {
    expect(spectrumEditSettingsToSearch(SPECTRUM_EDIT_DEFAULT_SETTINGS)).toBe(
      "ed=%5B%5D&from=0&h=1&to=0",
    );
  });
});

describe("spectrum edit validation", () => {
  it("accepts valid edits and rejects malformed ones", () => {
    expect(
      validSpectrumEdit({ startBin: 0, endBin: 2, target: "im", mode: "zero", value: 0 }),
    ).toBe(true);
    expect(
      validSpectrumEdit({ startBin: 2, endBin: 1, target: "im", mode: "zero", value: 0 }),
    ).toBe(false);
    expect(
      validSpectrumEdit({ startBin: 0, endBin: 2, target: "bogus", mode: "zero", value: 0 }),
    ).toBe(false);
    expect(
      validSpectrumEdit({ startBin: 0, endBin: 2, target: "im", mode: "scale", value: 2 }),
    ).toBe(true);
    expect(
      validSpectrumEdit({ startBin: 0, endBin: 2, target: "im", mode: "scale", value: Infinity }),
    ).toBe(false);
    expect(
      validSpectrumEdit({ startBin: -1, endBin: 2, target: "im", mode: "zero", value: 0 }),
    ).toBe(false);
  });
});

describe("spectrum edit helpers", () => {
  it("converts a Hz band to clamped bins", () => {
    // 8000 Hz / 1024 = 7.8125 Hz per bin.
    expect(binsFromHz(100, 500, 8000, 1024)).toEqual({ startBin: 12, endBin: 64 });
    expect(binsFromHz(0, 1e9, 8000, 64)).toEqual({ startBin: 0, endBin: 33 });
  });

  it("uses the selection, else the first capped block", () => {
    expect(defaultSpectrumEditRange({ startSample: 50, endSample: 250 }, 4000)).toEqual({
      startSample: 50,
      endSample: 250,
    });
    expect(defaultSpectrumEditRange({ startSample: 0, endSample: 0 }, 100)).toEqual({
      startSample: 0,
      endSample: 100,
    });
    expect(defaultSpectrumEditRange({ startSample: 0, endSample: 0 }, FFT_MAX_LENGTH + 10)).toEqual(
      { startSample: 0, endSample: FFT_MAX_LENGTH },
    );
  });

  it("replaces the edit list with a full-band preset", () => {
    const edits = presetEdits("zeroIm", 5);
    expect(edits).toEqual([{ startBin: 0, endBin: 5, target: "im", mode: "zero", value: 0 }]);
    expect(presetEdits("randomPhase", 4).length).toBe(4);
  });
});
