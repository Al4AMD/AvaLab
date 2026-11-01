import { describe, expect, it } from "vitest";

import {
  GENERATOR_DEFAULT_SETTINGS,
  type GeneratorSettings,
  generatorSettingsFromSearch,
  generatorSettingsToSearch,
} from "./generatorState";

describe("generator URL codec", () => {
  it("round-trips every setting including the chirp flag", () => {
    const settings: GeneratorSettings = {
      waveform: "chirp",
      sampleRateHz: 16000,
      durationSeconds: 12.5,
      amplitude: 0.25,
      frequencyHz: 300,
      dutyCycle: 0.3,
      impulseIndex: 77,
      stepIndex: 1200,
      chirpFromHz: 50,
      chirpToHz: 5000,
      chirpLog: false,
      tone2Hz: 990,
      seed: 42,
    };
    expect(generatorSettingsFromSearch(`?${generatorSettingsToSearch(settings)}`)).toEqual(
      settings,
    );
  });

  it("falls back per field on malformed input", () => {
    expect(generatorSettingsFromSearch("?w=nope&sr=12345&d=-4&a=9&cl=maybe")).toEqual({
      ...GENERATOR_DEFAULT_SETTINGS,
      chirpLog: true,
    });
  });

  it("emits a stable key order", () => {
    expect(generatorSettingsToSearch(GENERATOR_DEFAULT_SETTINGS)).toBe(
      "a=0.8&cf=100&cl=1&ct=8000&d=2&duty=0.5&f=440&f2=880&imp=0&seed=1&sr=48000&step=0&w=sine",
    );
  });
});
