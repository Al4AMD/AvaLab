import { describe, expect, it } from "vitest";

import { spectrogramTiles, type SpectrogramTilesParams } from "../../src/fourier/spectrogramTiles.js";

function sine(frequencyHz: number, sampleRateHz: number, length: number): Float64Array {
  const values = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    values[index] = Math.sin((2 * Math.PI * frequencyHz * index) / sampleRateHz);
  }
  return values;
}

const BASE: SpectrogramTilesParams = {
  sampleRateHz: 1024,
  windowFamily: "rect",
  windowLengthSamples: 256,
  hopFraction: 0.25,
  dbFloorDb: -120,
  rowStart: 0,
  rowCount: 1,
  sourceStartSample: 0,
};

describe("spectrogramTiles", () => {
  it("puts a pure tone in its bin and reports frame metadata", () => {
    const samples = sine(128, 1024, 1024);
    const result = spectrogramTiles(samples, BASE);
    expect(result.columnCount).toBe(129);
    expect(result.hopLengthSamples).toBe(64);
    expect(result.rows.length).toBe(129);
    let dominant = 0;
    let dominantDb = Number.NEGATIVE_INFINITY;
    for (let column = 0; column < result.columnCount; column += 1) {
      const value = result.rows[column];
      if (value !== undefined && value > dominantDb) {
        dominant = column;
        dominantDb = value;
      }
    }
    expect(dominant).toBe(32);
    expect(dominantDb).toBeCloseTo(20 * Math.log10(128), 1);
  });

  it("clamps silence to the dB floor", () => {
    const result = spectrogramTiles(new Float64Array(512), BASE);
    expect([...result.rows].every((value) => value === -120)).toBe(true);
  });

  it("chunks match the same rows of a full run", () => {
    const samples = sine(64, 1024, 1024);
    const full = spectrogramTiles(samples, { ...BASE, rowCount: 4 });
    const chunk = spectrogramTiles(samples.slice(64), {
      ...BASE,
      rowStart: 1,
      rowCount: 2,
      sourceStartSample: 64,
    });
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < chunk.columnCount; column += 1) {
        expect(chunk.rows[row * chunk.columnCount + column]).toBeCloseTo(
          full.rows[(row + 1) * full.columnCount + column] ?? Number.NaN,
          5,
        );
      }
    }
  });

  it("rejects a slice that starts after the first requested frame", () => {
    expect(() =>
      spectrogramTiles(new Float64Array(512), { ...BASE, sourceStartSample: 1 }),
    ).toThrowError(/sourceStartSample/);
  });

  it("rejects a window family outside the supported union", () => {
    expect(() =>
      spectrogramTiles(
        new Float64Array(512),
        { ...BASE, windowFamily: "triangle" as unknown as SpectrogramTilesParams["windowFamily"] },
      ),
    ).toThrowError(/windowFamily/);
  });
});
