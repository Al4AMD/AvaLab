import { describe, expect, it } from "vitest";
import type {
  PipelineGraph,
  PipelineNode,
  PipelineOutput,
  PipelineRunResult,
  ReverbProcessParams,
} from "../../src/index.js";
import {
  floatToInt16Pcm,
  int16PcmToFloat,
  PipelineRunError,
  runPipeline,
} from "../../src/index.js";

const source: PipelineNode = {
  id: "source",
  kind: "source",
  params: {},
  position: { x: 0, y: 0 },
};
const output: PipelineNode = {
  id: "output",
  kind: "output",
  params: { label: "Out" },
  position: { x: 300, y: 0 },
};
const reverseNode: PipelineNode = {
  id: "reverse",
  kind: "reverse",
  params: {},
  position: { x: 150, y: 0 },
};

function edge(id: string, from: string, to: string) {
  return { id, from, to };
}

function graph(nodes: readonly PipelineNode[], edges: ReturnType<typeof edge>[]): PipelineGraph {
  return { version: 1, nodes, edges };
}

function outputOf(result: PipelineRunResult, index = 0): PipelineOutput {
  const value = result.outputs[index];
  if (value === undefined) {
    throw new Error(`missing output ${index}`);
  }
  return value;
}

function sliceOfOutput(result: PipelineRunResult, outputInfo: PipelineOutput): Float32Array {
  return result.samples.subarray(
    outputInfo.offsetSamples,
    outputInfo.offsetSamples + outputInfo.sampleCount,
  );
}

function reverbParams(overrides: Partial<ReverbProcessParams> = {}): ReverbProcessParams {
  return {
    sampleRateHz: 8000,
    startSample: 0,
    endSample: 64,
    ir: { kind: "hall", durationSeconds: 0.01, rt60Seconds: 0.01, seed: 1 },
    uploadedIrSampleCount: 0,
    preDelayMs: 0,
    wetMix: 0.5,
    method: "fft",
    ...overrides,
  };
}

describe("runPipeline", () => {
  it("runs a linear chain and returns only output PCM", () => {
    const input = Float32Array.from([1, 2, 3, 4]);
    const result = runPipeline(
      input,
      4,
      graph(
        [source, reverseNode, output],
        [edge("e1", "source", "reverse"), edge("e2", "reverse", "output")],
      ),
      { envelopeBuckets: 2 },
    );

    expect(result.stages.map((stage) => stage.nodeId)).toEqual(["source", "reverse", "output"]);
    expect(result.outputs).toHaveLength(1);
    expect(outputOf(result).label).toBe("Out");
    expect(Array.from(sliceOfOutput(result, outputOf(result)))).toEqual([4, 3, 2, 1]);
    expect(result.samples).toHaveLength(4);
    for (const stage of result.stages) {
      expect(stage.envelope).toHaveLength(4);
      expect(stage.peak).toBeGreaterThan(0);
      expect(stage.rms).toBeGreaterThan(0);
      expect(stage.durationSeconds).toBeCloseTo(stage.sampleCount / stage.sampleRateHz, 12);
      expect(stage).not.toHaveProperty("samples");
    }
  });

  it("executes fan-out branches independently and concatenates outputs in node order", () => {
    const outputB: PipelineNode = {
      ...output,
      id: "output-b",
      params: { label: "B" },
      position: { x: 300, y: 100 },
    };
    const result = runPipeline(
      Float32Array.from([1, 2, 3, 4]),
      4,
      graph(
        [source, reverseNode, output, outputB],
        [
          edge("e1", "source", "reverse"),
          edge("e2", "reverse", "output"),
          edge("e3", "source", "output-b"),
        ],
      ),
      { envelopeBuckets: 2 },
    );

    expect(result.outputs.map((entry) => entry.label)).toEqual(["Out", "B"]);
    expect(result.outputs.map((entry) => entry.offsetSamples)).toEqual([0, 4]);
    expect(Array.from(sliceOfOutput(result, outputOf(result, 0)))).toEqual([4, 3, 2, 1]);
    expect(Array.from(sliceOfOutput(result, outputOf(result, 1)))).toEqual([1, 2, 3, 4]);
    expect(result.samples).toHaveLength(8);
  });

  it("resamples and updates the working rate", () => {
    const input = Float32Array.from({ length: 64 }, (_, index) =>
      Math.sin((2 * Math.PI * index) / 16),
    );
    const resample: PipelineNode = {
      id: "resample",
      kind: "resample",
      params: { targetRateHz: 4000, antiAlias: true },
      position: { x: 100, y: 0 },
    };
    const result = runPipeline(
      input,
      8000,
      graph(
        [source, resample, output],
        [edge("e1", "source", "resample"), edge("e2", "resample", "output")],
      ),
      { envelopeBuckets: 2 },
    );

    expect(result.samples).toHaveLength(32);
    expect(outputOf(result).sampleRateHz).toBe(4000);
    expect(result.stages.find((stage) => stage.nodeId === "resample")?.sampleRateHz).toBe(4000);
  });

  it("round-trips the codec stage through the shared codec primitives", () => {
    const input = Float32Array.from([0, 0.5, -0.5, 0.25, -0.25, 0, 0.75, -0.75]);
    const codec: PipelineNode = {
      id: "codec",
      kind: "codec",
      params: {
        codec: "rle",
        mdctBitsPerSecond: 128_000,
        psychoacoustic: false,
        referenceSplDb: 94,
      },
      position: { x: 100, y: 0 },
    };
    const result = runPipeline(
      input,
      8000,
      graph(
        [source, codec, output],
        [edge("e1", "source", "codec"), edge("e2", "codec", "output")],
      ),
      { envelopeBuckets: 2 },
    );

    const expected = int16PcmToFloat(floatToInt16Pcm(input));
    expect(Array.from(sliceOfOutput(result, outputOf(result)))).toEqual(Array.from(expected));
  });

  it("applies reverb and keeps the convolution tail", () => {
    const reverb: PipelineNode = {
      id: "reverb",
      kind: "reverb",
      params: reverbParams(),
      position: { x: 100, y: 0 },
    };
    const result = runPipeline(
      Float32Array.from({ length: 64 }, () => 0.1),
      8000,
      graph(
        [source, reverb, output],
        [edge("e1", "source", "reverb"), edge("e2", "reverb", "output")],
      ),
      { envelopeBuckets: 3 },
    );

    expect(result.samples).toHaveLength(64 + 80 - 1);
    expect(outputOf(result).sampleRateHz).toBe(8000);
    expect(result.stages.find((stage) => stage.nodeId === "reverb")?.envelope).toHaveLength(6);
    for (const sample of result.samples) {
      expect(Number.isFinite(sample)).toBe(true);
    }
  });

  it("time-stretches with speed and pitch controls", () => {
    const input = Float32Array.from({ length: 4000 }, (_, index) =>
      Math.sin((2 * Math.PI * 440 * index) / 8000),
    );
    const stretch: PipelineNode = {
      id: "stretch",
      kind: "timeStretch",
      params: { speedFactor: 2, pitchSemitones: 0 },
      position: { x: 100, y: 0 },
    };
    const result = runPipeline(
      input,
      8000,
      graph(
        [source, stretch, output],
        [edge("e1", "source", "stretch"), edge("e2", "stretch", "output")],
      ),
      { envelopeBuckets: 2 },
    );

    expect(result.samples).toHaveLength(2000);
    expect(outputOf(result).sampleRateHz).toBe(8000);
  });

  it("throws a typed validation error before running an invalid graph", () => {
    expect(() => runPipeline(Float32Array.from([1]), 8000, graph([source], []))).toThrow(
      PipelineRunError,
    );
    try {
      runPipeline(Float32Array.from([1]), 8000, graph([source], []));
    } catch (error) {
      expect(error).toBeInstanceOf(PipelineRunError);
      expect((error as PipelineRunError).code).toBe("noOutput");
    }
  });

  it("rejects non-finite samples and rates", () => {
    expect(() =>
      runPipeline(
        Float32Array.from([Number.NaN]),
        8000,
        graph([source, output], [edge("e", "source", "output")]),
      ),
    ).toThrow(TypeError);
    expect(() =>
      runPipeline(
        Float32Array.from([1]),
        Number.POSITIVE_INFINITY,
        graph([source, output], [edge("e", "source", "output")]),
      ),
    ).toThrow(RangeError);
  });
});
