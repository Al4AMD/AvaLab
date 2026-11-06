import { describe, expect, it } from "vitest";
import {
  type CodecLabParams,
  codecLabProcess,
  DspOpError,
  dspOps,
  psychoacousticAnalysis,
  psychoacousticCurves,
} from "./ops";
import type { TransferablePayload } from "./protocol";
import { float32PayloadOf } from "./testDoubles";

const SAMPLE_RATE = 48_000;

function sinePayload(seconds: number, frequencyHz = 1_000): TransferablePayload {
  const count = Math.round(SAMPLE_RATE * seconds);
  return float32PayloadOf(
    Array.from({ length: count }, (_, index) =>
      Math.sin((2 * Math.PI * frequencyHz * index) / SAMPLE_RATE),
    ),
  );
}

function runCodec(
  overrides: Partial<CodecLabParams> = {},
  payload: TransferablePayload = sinePayload(0.25),
) {
  return codecLabProcess(
    {
      codec: "mdct",
      sampleRateHz: SAMPLE_RATE,
      startSample: 0,
      endSample: Math.round(SAMPLE_RATE * 0.25),
      mdctBitsPerSecond: 128_000,
      ...overrides,
    },
    payload,
  );
}

function expectBadParams(act: () => unknown): void {
  try {
    act();
    expect.unreachable("expected a badParams throw");
  } catch (error) {
    expect(error).toBeInstanceOf(DspOpError);
    expect((error as DspOpError).code).toBe("badParams");
  }
}

describe("codecLabProcess psychoacoustic mode", () => {
  it("keeps the legacy MDCT path when the flag is omitted", () => {
    const meta = runCodec().meta;
    expect(meta.psychoacoustic).toBe(false);
    expect(meta.mdctEntropyBits).toBeNull();
    expect(meta.mdctSideInfoBits).toBeNull();
    expect(meta.mdctMaskedFraction).toBeNull();
    expect(meta.mdctBands).toBeNull();
  });

  it("reports finite masking stats and per-band side information", () => {
    const meta = runCodec({
      mdctPsychoacoustic: true,
      mdctReferenceSplDb: 94,
    }).meta;
    expect(meta.psychoacoustic).toBe(true);
    expect(meta.mdctEntropyBits).not.toBeNull();
    expect(meta.mdctSideInfoBits).not.toBeNull();
    expect(meta.mdctMaskedFraction).not.toBeNull();
    expect(Number.isFinite(meta.mdctEntropyBits ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(meta.mdctSideInfoBits ?? Number.NaN)).toBe(true);
    expect(meta.mdctMaskedFraction ?? -1).toBeGreaterThanOrEqual(0);
    expect(meta.mdctMaskedFraction ?? 2).toBeLessThanOrEqual(1);
    expect(meta.mdctBands).toHaveLength(25);
    expect(meta.mdctBands?.every((band) => Number.isFinite(band.thresholdDb))).toBe(true);
    expect(meta.mdctBands?.every((band) => band.step > 0)).toBe(true);
    expect(meta.mdctSideInfoBits).toBe((meta.frameCount ?? 0) * 25 * 16);
    expect(meta.bitrateKbps).toBeCloseTo(
      (((meta.mdctEntropyBits ?? 0) + (meta.mdctSideInfoBits ?? 0)) * SAMPLE_RATE) /
        meta.sampleCount /
        1000,
      9,
    );
  });

  it("rejects a reference SPL outside 80..100", () => {
    for (const reference of [79, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectBadParams(() => runCodec({ mdctReferenceSplDb: reference }));
    }
  });
});

describe("psychoacousticCurves", () => {
  it("returns 26 edges, 25 centers and the symmetric 25 x 25 spreading matrix", () => {
    const { meta } = psychoacousticCurves({
      sampleRateHz: SAMPLE_RATE,
      referenceSplDb: 94,
    });
    expect(meta.bandEdgesHz).toHaveLength(26);
    expect(meta.bandCentersHz).toHaveLength(25);
    expect(meta.bandCentersBark).toHaveLength(25);
    expect(meta.athDb).toHaveLength(25);
    expect(meta.spreadingDb).toHaveLength(25 * 25);
    expect(meta.bandEdgesHz[0]).toBe(0);
    expect(meta.bandEdgesHz[25]).toBeCloseTo(SAMPLE_RATE / 2, 6);
    for (let row = 0; row < 25; row += 1) {
      for (let column = 0; column < 25; column += 1) {
        expect(meta.spreadingDb[row * 25 + column]).toBeCloseTo(
          meta.spreadingDb[column * 25 + row] ?? Number.NaN,
          12,
        );
      }
    }
    expect(meta.athDb.every((value) => Number.isFinite(value))).toBe(true);
  });
});

describe("psychoacousticAnalysis", () => {
  it("analyzes the loudest frame and reports one row per band", () => {
    const result = psychoacousticAnalysis(
      {
        sampleRateHz: SAMPLE_RATE,
        startSample: 0,
        endSample: SAMPLE_RATE,
        referenceSplDb: 94,
      },
      sinePayload(1),
    );
    expect(result.meta.frameCount).toBeGreaterThan(0);
    expect(result.meta.bands).toHaveLength(25);
    const toneBand = result.meta.bands.find((band) => band.lowHz <= 1_000 && 1_000 < band.highHz);
    expect(toneBand?.levelDb ?? Number.NEGATIVE_INFINITY).toBeGreaterThan(80);
    expect(result.meta.bands.every((band) => Number.isFinite(band.thresholdDb))).toBe(true);
  });

  it("rejects an empty selection, a >30 s selection and a missing payload", () => {
    const params = {
      sampleRateHz: 1_000,
      startSample: 0,
      endSample: 31_000,
      referenceSplDb: 94,
    };
    expectBadParams(() =>
      psychoacousticAnalysis(params, float32PayloadOf(Array.from({ length: 31_000 }, () => 0))),
    );
    expectBadParams(() =>
      psychoacousticAnalysis({ ...params, endSample: 0 }, float32PayloadOf([])),
    );
    try {
      psychoacousticAnalysis(params);
      expect.unreachable("expected a badPayload throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DspOpError);
      expect((error as DspOpError).code).toBe("badPayload");
    }
  });
});

describe("psychoacoustics op wiring", () => {
  it("registers both handlers in the op table", () => {
    expect(dspOps.psychoacousticCurves.handler).toBe(psychoacousticCurves);
    expect(dspOps.psychoacousticAnalysis.handler).toBe(psychoacousticAnalysis);
  });
});
