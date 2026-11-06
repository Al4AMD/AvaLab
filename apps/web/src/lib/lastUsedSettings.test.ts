import { describe, expect, it } from "vitest";

import { AI_STORAGE_KEY, loadAiTask } from "../features/ai/aiState";
import {
  CODEC_LAB_DEFAULT_SETTINGS,
  CODEC_LAB_STORAGE_KEY,
  codecLabSettingsToSearch,
  loadCodecLabSettings,
} from "../features/codecLab/codecLabState";
import {
  EXTENT_DEFAULT_SETTINGS,
  EXTENT_STORAGE_KEY,
  extentSettingsToSearch,
  loadExtentSettings,
} from "../features/extent/extentState";
import {
  defaultPipelineState,
  encodePipelineState,
  loadPipelineState,
  PIPELINE_STORAGE_KEY,
} from "../features/pipeline/pipelineState";
import {
  loadPsychoacousticsSettings,
  PSYCHOACOUSTICS_DEFAULT_SETTINGS,
  PSYCHOACOUSTICS_STORAGE_KEY,
  psychoacousticsSettingsToSearch,
} from "../features/psychoacoustics/psychoacousticsState";
import {
  loadReverbSettings,
  REVERB_DEFAULT_SETTINGS,
  REVERB_STORAGE_KEY,
  reverbSettingsToSearch,
} from "../features/reverb/reverbState";
import {
  loadSamplingSettings,
  SAMPLING_DEFAULT_SETTINGS,
  SAMPLING_STORAGE_KEY,
  samplingSettingsToSearch,
} from "../features/sampling/samplingState";
import {
  loadSpectrumEditSettings,
  SPECTRUM_EDIT_DEFAULT_SETTINGS,
  SPECTRUM_EDIT_STORAGE_KEY,
  spectrumEditSettingsToSearch,
} from "../features/spectrumEdit/spectrumEditState";
import {
  loadSpeedSettings,
  SPEED_DEFAULT_SETTINGS,
  SPEED_STORAGE_KEY,
  speedSettingsToSearch,
} from "../features/speed/speedState";
import type { LastUsedStorage } from "./lastUsed";

const SOURCE = { sampleCount: 96_000, sampleRateHz: 48_000 };
const SELECTION = { startSample: 0, endSample: 96_000 };

function storage(value: string | null): LastUsedStorage {
  return { getItem: () => value, setItem: () => undefined };
}

describe("last-used settings storage", () => {
  it("keeps stable namespaced keys", () => {
    expect([
      AI_STORAGE_KEY,
      CODEC_LAB_STORAGE_KEY,
      EXTENT_STORAGE_KEY,
      PIPELINE_STORAGE_KEY,
      PSYCHOACOUSTICS_STORAGE_KEY,
      REVERB_STORAGE_KEY,
      SAMPLING_STORAGE_KEY,
      SPEED_STORAGE_KEY,
      SPECTRUM_EDIT_STORAGE_KEY,
    ]).toEqual([
      "avalab.ai.last",
      "avalab.codec-lab.last",
      "avalab.extent.last",
      "avalab.pipeline.last",
      "avalab.psychoacoustics.last",
      "avalab.reverb.last",
      "avalab.sampling.last",
      "avalab.speed.last",
      "avalab.spectrum-edit.last",
    ]);
  });

  it("round-trips valid stored settings", () => {
    const speed = {
      ...SPEED_DEFAULT_SETTINGS,
      mode: "timeStretch" as const,
      speedFactor: 2,
      semitones: 3,
      reverse: true,
    };
    expect(loadSpeedSettings(SOURCE, SELECTION, storage(speedSettingsToSearch(speed)))).toEqual({
      ...speed,
      endSample: 96_000,
    });

    const sampling = {
      ...SAMPLING_DEFAULT_SETTINGS,
      targetRateHz: 8_000,
      antiAlias: false,
      bits: 8,
      dither: true,
      seed: 42,
    };
    expect(
      loadSamplingSettings(SOURCE, SELECTION, storage(samplingSettingsToSearch(sampling))),
    ).toEqual({ ...sampling, endSample: 96_000 });

    const extent = { ...EXTENT_DEFAULT_SETTINGS, operation: "shift" as const, shiftSamples: 100 };
    expect(loadExtentSettings(SOURCE, SELECTION, storage(extentSettingsToSearch(extent)))).toEqual({
      ...extent,
      endSample: 96_000,
    });

    const reverb = {
      ...REVERB_DEFAULT_SETTINGS,
      irKind: "plate" as const,
      preDelayMs: 50,
      wetMix: 0.7,
      method: "direct" as const,
    };
    expect(loadReverbSettings(SOURCE, SELECTION, storage(reverbSettingsToSearch(reverb)))).toEqual({
      ...reverb,
      endSample: 96_000,
    });

    const spectrum = { ...SPECTRUM_EDIT_DEFAULT_SETTINGS, hermitian: false };
    expect(
      loadSpectrumEditSettings(SOURCE, SELECTION, storage(spectrumEditSettingsToSearch(spectrum))),
    ).toEqual({ ...spectrum, endSample: 96_000 });

    const codecLab = {
      ...CODEC_LAB_DEFAULT_SETTINGS,
      codec: "mdct" as const,
      mdctPsychoacoustic: false,
      mdctReferenceSplDb: 90,
    };
    expect(
      loadCodecLabSettings(SOURCE, SELECTION, storage(codecLabSettingsToSearch(codecLab))),
    ).toEqual({ ...codecLab, endSample: 96_000 });

    expect(loadAiTask(storage("task=asr"))).toBe("asr");

    const psycho = {
      ...PSYCHOACOUSTICS_DEFAULT_SETTINGS,
      referenceSplDb: 88,
      frequencyScale: "linear" as const,
      showThreshold: false,
    };
    expect(loadPsychoacousticsSettings(storage(psychoacousticsSettingsToSearch(psycho)))).toEqual(
      psycho,
    );

    const pipeline = encodePipelineState(defaultPipelineState());
    expect(loadPipelineState(storage(pipeline.search)).warning).toBeNull();
  });

  it("falls back to defaults when storage is missing or invalid", () => {
    expect(loadSpeedSettings(SOURCE, SELECTION, storage("sp=nope"))).toEqual({
      ...SPEED_DEFAULT_SETTINGS,
      startSample: 0,
      endSample: 96_000,
    });
    expect(loadSamplingSettings(SOURCE, SELECTION, storage("mbr=bad"))).toEqual({
      ...SAMPLING_DEFAULT_SETTINGS,
      startSample: 0,
      endSample: 96_000,
    });
    expect(loadExtentSettings(SOURCE, SELECTION, storage("op=bad"))).toEqual({
      ...EXTENT_DEFAULT_SETTINGS,
      truncateLengthSamples: 48_000,
      startSample: 0,
      endSample: 96_000,
    });
    expect(loadReverbSettings(SOURCE, SELECTION, storage("ir=bad"))).toEqual({
      ...REVERB_DEFAULT_SETTINGS,
      startSample: 0,
      endSample: 96_000,
    });
    expect(loadSpectrumEditSettings(SOURCE, SELECTION, storage("ed=bad"))).toEqual({
      ...SPECTRUM_EDIT_DEFAULT_SETTINGS,
      startSample: 0,
      endSample: 96_000,
    });
    expect(loadCodecLabSettings(SOURCE, SELECTION, storage("c=bad"))).toEqual({
      ...CODEC_LAB_DEFAULT_SETTINGS,
      mdctPsychoacoustic: false,
      startSample: 0,
      endSample: 96_000,
    });
    expect(loadAiTask(storage("task=bogus"))).toBe("denoise");
    expect(loadPsychoacousticsSettings(storage("fs=bogus"))).toEqual(
      PSYCHOACOUSTICS_DEFAULT_SETTINGS,
    );
    expect(loadPipelineState(storage("pg=not-json")).warning).toBe("invalid");
    expect(loadPipelineState(storage(null)).warning).toBeNull();
  });
});
