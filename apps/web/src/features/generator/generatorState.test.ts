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
      ...GENERATOR_DEFAULT_SETTINGS,
      waveform: "chirp",
      sampleRateHz: 16000,
      durationSeconds: 12.5,
      amplitude: 0.25,
      frequencyHz: 300,
      dutyCycle: 0.3,
      eventStartSeconds: 0.75,
      eventCount: 4,
      eventIntervalSeconds: 0.125,
      chirpFromHz: 50,
      chirpToHz: 5000,
      chirpLog: false,
      tone2Hz: 990,
      seed: 42,
      modulationHz: 7,
      modulationIndex: 2,
      frequencyDeviationHz: 1500,
      fourierKind: "triangle",
      fourierHarmonics: 45,
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

  it("clamps modulation and Fourier fields independently", () => {
    const settings = generatorSettingsFromSearch("?mh=-1&mi=99&dev=999999&fk=bogus&fh=0");
    expect(settings.modulationHz).toBe(GENERATOR_DEFAULT_SETTINGS.modulationHz);
    expect(settings.modulationIndex).toBe(GENERATOR_DEFAULT_SETTINGS.modulationIndex);
    expect(settings.frequencyDeviationHz).toBe(GENERATOR_DEFAULT_SETTINGS.frequencyDeviationHz);
    expect(settings.fourierKind).toBe(GENERATOR_DEFAULT_SETTINGS.fourierKind);
    expect(settings.fourierHarmonics).toBe(GENERATOR_DEFAULT_SETTINGS.fourierHarmonics);
  });

  it("falls back invalid event timing independently", () => {
    const settings = generatorSettingsFromSearch("?evt=-1&evn=0&evg=999");
    expect(settings.eventStartSeconds).toBe(GENERATOR_DEFAULT_SETTINGS.eventStartSeconds);
    expect(settings.eventCount).toBe(GENERATOR_DEFAULT_SETTINGS.eventCount);
    expect(settings.eventIntervalSeconds).toBe(GENERATOR_DEFAULT_SETTINGS.eventIntervalSeconds);
  });

  it("emits a stable key order", () => {
    expect(generatorSettingsToSearch(GENERATOR_DEFAULT_SETTINGS)).toBe(
      "a=0.8&cf=100&cl=1&ct=8000&d=2&dev=1000&duty=0.5&evg=0.5&evn=1&evt=0&f=440&f2=880&fh=10&fk=square&mh=5&mi=0.5&seed=1&sr=48000&w=sine",
    );
  });
});
