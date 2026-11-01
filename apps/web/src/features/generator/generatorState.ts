/**
 * URL + localStorage codec for the signal generator (F12/F16). Same total
 * decoding rule as the Fourier view: one bad field falls back alone, so an
 * old share link still opens a working generator. Booleans ride as "0"/"1"
 * because the shared URL codec only knows strings and finite numbers.
 */
import { decodeParams, encodeParams } from "../../lib/url-state";
import type { SynthWaveform } from "../../session/ops";

export type GeneratorSettings = {
  readonly waveform: SynthWaveform;
  readonly sampleRateHz: number;
  readonly durationSeconds: number;
  readonly amplitude: number;
  readonly frequencyHz: number;
  readonly dutyCycle: number;
  readonly impulseIndex: number;
  readonly stepIndex: number;
  readonly chirpFromHz: number;
  readonly chirpToHz: number;
  readonly chirpLog: boolean;
  readonly tone2Hz: number;
  readonly seed: number;
};

export const GENERATOR_WAVEFORMS: readonly SynthWaveform[] = [
  "sine",
  "square",
  "sawtooth",
  "triangle",
  "impulse",
  "step",
  "whiteNoise",
  "pinkNoise",
  "chirp",
  "twoTone",
];
export const GENERATOR_SAMPLE_RATES = [8000, 16000, 22050, 32000, 44100, 48000, 96000] as const;
export const GENERATOR_MAX_DURATION_S = 300;
export const GENERATOR_STORAGE_KEY = "avalab.generator.last";
export const GENERATOR_DEFAULT_SETTINGS: GeneratorSettings = {
  waveform: "sine",
  sampleRateHz: 48000,
  durationSeconds: 2,
  amplitude: 0.8,
  frequencyHz: 440,
  dutyCycle: 0.5,
  impulseIndex: 0,
  stepIndex: 0,
  chirpFromHz: 100,
  chirpToHz: 8000,
  chirpLog: true,
  tone2Hz: 880,
  seed: 1,
};

function finiteIn(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function integerIn(value: number, min: number, max: number, fallback: number): number {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export function generatorSettingsToSearch(settings: GeneratorSettings): string {
  return encodeParams({
    a: settings.amplitude,
    cf: settings.chirpFromHz,
    cl: settings.chirpLog ? 1 : 0,
    ct: settings.chirpToHz,
    d: settings.durationSeconds,
    duty: settings.dutyCycle,
    f: settings.frequencyHz,
    f2: settings.tone2Hz,
    imp: settings.impulseIndex,
    seed: settings.seed,
    sr: settings.sampleRateHz,
    step: settings.stepIndex,
    w: settings.waveform,
  });
}

export function generatorSettingsFromSearch(search: string): GeneratorSettings {
  const decoded = decodeParams(search);
  const scalar = (key: string): string | undefined => {
    const value = decoded[key];
    return typeof value === "string" ? value : undefined;
  };
  const defaults = GENERATOR_DEFAULT_SETTINGS;
  const waveform = scalar("w");
  const sampleRate = Number(scalar("sr"));
  return {
    waveform:
      waveform !== undefined && (GENERATOR_WAVEFORMS as readonly string[]).includes(waveform)
        ? (waveform as SynthWaveform)
        : defaults.waveform,
    sampleRateHz: (GENERATOR_SAMPLE_RATES as readonly number[]).includes(sampleRate)
      ? sampleRate
      : defaults.sampleRateHz,
    durationSeconds: finiteIn(
      Number(scalar("d")),
      0.05,
      GENERATOR_MAX_DURATION_S,
      defaults.durationSeconds,
    ),
    amplitude: finiteIn(Number(scalar("a")), 0, 1, defaults.amplitude),
    frequencyHz: finiteIn(Number(scalar("f")), 1, 48000, defaults.frequencyHz),
    dutyCycle: finiteIn(Number(scalar("duty")), 0.01, 1, defaults.dutyCycle),
    impulseIndex: integerIn(Number(scalar("imp")), 0, 1e9, defaults.impulseIndex),
    stepIndex: integerIn(Number(scalar("step")), 0, 1e9, defaults.stepIndex),
    chirpFromHz: finiteIn(Number(scalar("cf")), 1, 48000, defaults.chirpFromHz),
    chirpToHz: finiteIn(Number(scalar("ct")), 1, 48000, defaults.chirpToHz),
    chirpLog: scalar("cl") !== "0",
    tone2Hz: finiteIn(Number(scalar("f2")), 1, 48000, defaults.tone2Hz),
    seed: integerIn(Number(scalar("seed")), 0, 2 ** 31 - 1, defaults.seed),
  };
}
