import type { PipelineGraph, PipelineNode } from "@avalab/dsp";
import { describe, expect, it } from "vitest";

import {
  type CodecLabCodec,
  codecLabProcess,
  DspOpError,
  type PipelineRunParams,
  pipelineRun,
  reverbProcess,
} from "./ops";
import type { TransferablePayload } from "./protocol";
import { createDspRpc } from "./rpc";
import { createSessionStore } from "./store";
import { float32PayloadOf, makeFakeTransport, requestAt } from "./testDoubles";

const GRAPH: PipelineGraph = {
  version: 1,
  nodes: [
    { id: "in", kind: "source", position: { x: 0, y: 0 }, params: {} },
    { id: "flip", kind: "reverse", position: { x: 180, y: 0 }, params: {} },
    { id: "out", kind: "output", position: { x: 360, y: 0 }, params: { label: "Out" } },
  ],
  edges: [
    { id: "e1", from: "in", to: "flip" },
    { id: "e2", from: "flip", to: "out" },
  ],
};

function params(overrides: Partial<PipelineRunParams> = {}): PipelineRunParams {
  return { graph: GRAPH, sampleRateHz: 4, startSample: 0, endSample: 4, ...overrides };
}

function graphWith(node: PipelineNode): PipelineGraph {
  return {
    version: 1,
    nodes: [
      { id: "in", kind: "source", position: { x: 0, y: 0 }, params: {} },
      node,
      { id: "out", kind: "output", position: { x: 360, y: 0 }, params: { label: "Out" } },
    ],
    edges: [
      { id: "e1", from: "in", to: node.id },
      { id: "e2", from: node.id, to: "out" },
    ],
  };
}

function expectBadParams(run: () => unknown): void {
  expect(run).toThrow(DspOpError);
  expect(run).toThrow(expect.objectContaining({ code: "badParams" }));
}

function samplesOf(payload: TransferablePayload): number[] {
  return [...new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4)];
}

describe("pipelineRun", () => {
  it("returns stage summaries, outputs and the final samples as the payload", () => {
    const result = pipelineRun(params(), float32PayloadOf([1, 2, 3, 4]));

    expect(result.meta.outputs).toEqual([
      { nodeId: "out", label: "Out", offsetSamples: 0, sampleCount: 4, sampleRateHz: 4 },
    ]);
    expect(result.meta.stages.map((stage) => stage.nodeId)).toEqual(["in", "flip", "out"]);
    expect(samplesOf(result.payload)).toEqual([4, 3, 2, 1]);
  });

  it("rejects excerpts above the 30 s cap before running the graph", () => {
    const values = new Array<number>(30_001).fill(0);
    expectBadParams(() =>
      pipelineRun(
        params({ sampleRateHz: 1_000, startSample: 0, endSample: 30_001 }),
        float32PayloadOf(values),
      ),
    );
  });

  it("rejects a payload whose length does not match the excerpt range", () => {
    expectBadParams(() => pipelineRun(params(), float32PayloadOf([1, 2, 3])));
  });

  it("keeps graph validation codes typed", () => {
    const graph: PipelineGraph = {
      ...GRAPH,
      nodes: GRAPH.nodes.filter((node) => node.kind !== "output"),
      edges: [{ id: "e1", from: "in", to: "flip" }],
    };
    try {
      pipelineRun(params({ graph }), float32PayloadOf([1, 2, 3, 4]));
      expect.unreachable("pipelineRun must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DspOpError);
      expect((error as DspOpError).code).toBe("noOutput");
    }
  });

  it("decodes every codec exactly like the F04 codec lab", () => {
    const sampleRateHz = 8_000;
    const samples = Array.from(
      { length: 1_024 },
      (_, index) => 0.5 * Math.sin((2 * Math.PI * 440 * index) / sampleRateHz),
    );
    const codecs: readonly CodecLabCodec[] = [
      "rle",
      "huffman",
      "deltaHuffman",
      "mulaw",
      "alaw",
      "mdct",
    ];
    for (const codec of codecs) {
      for (const psychoacoustic of codec === "mdct" ? [false, true] : [false]) {
        const graph = graphWith({
          id: "fx",
          kind: "codec",
          position: { x: 180, y: 0 },
          params: {
            codec,
            mdctBitsPerSecond: 128_000,
            psychoacoustic,
            referenceSplDb: 94,
          },
        });
        const pipeline = pipelineRun(
          {
            graph,
            sampleRateHz,
            startSample: 0,
            endSample: samples.length,
          },
          float32PayloadOf(samples),
        );
        const lab = codecLabProcess(
          {
            codec,
            sampleRateHz,
            startSample: 0,
            endSample: samples.length,
            mdctBitsPerSecond: 128_000,
            mdctPsychoacoustic: psychoacoustic,
            mdctReferenceSplDb: 94,
          },
          float32PayloadOf(samples),
        );
        expect(lab.payload).toBeDefined();
        expect(samplesOf(pipeline.payload)).toEqual(samplesOf(lab.payload as TransferablePayload));
      }
    }
  });

  it("mixes reverb exactly like the F10 reverb tool", () => {
    const sampleRateHz = 8_000;
    const samples = Array.from({ length: 2_048 }, (_, index) =>
      Math.sin((2 * Math.PI * 220 * index) / sampleRateHz),
    );
    const ir = { kind: "hall" as const, durationSeconds: 0.2, rt60Seconds: 0.8, seed: 7 };
    const pipeline = pipelineRun(
      {
        graph: graphWith({
          id: "fx",
          kind: "reverb",
          position: { x: 180, y: 0 },
          params: {
            sampleRateHz,
            startSample: 0,
            endSample: samples.length,
            ir,
            uploadedIrSampleCount: 0,
            preDelayMs: 10,
            wetMix: 0.4,
            method: "fft",
          },
        }),
        sampleRateHz,
        startSample: 0,
        endSample: samples.length,
      },
      float32PayloadOf(samples),
    );
    const reverb = reverbProcess(
      {
        sampleRateHz,
        startSample: 0,
        endSample: samples.length,
        ir,
        uploadedIrSampleCount: 0,
        preDelayMs: 10,
        wetMix: 0.4,
        method: "fft",
      },
      float32PayloadOf(samples),
    );
    expect(reverb.payload).toBeDefined();
    expect(samplesOf(pipeline.payload)).toEqual(samplesOf(reverb.payload as TransferablePayload));
  });

  it("keys different excerpt ranges separately and posts only the slice", async () => {
    const transport = makeFakeTransport("echo");
    const store = createSessionStore(createDspRpc(transport));
    const source = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(store.getState().loadSource(source, 4, "a.wav", "demoClip")).toEqual({ ok: true });

    const first = store
      .getState()
      .deriveWithSourceSlice("pipelineRun", params({ startSample: 0, endSample: 4 }), 0, 4);
    const second = store
      .getState()
      .deriveWithSourceSlice("pipelineRun", params({ startSample: 4, endSample: 8 }), 4, 8);

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.key).not.toBe(second?.key);
    expect(first?.key).toContain(`"startSample":0`);
    expect(second?.key).toContain(`"startSample":4`);

    const sent = requestAt(transport, 0);
    expect(sent.payload?.byteLength).toBe(16);
    expect(transport.receivedFrames[0]?.payloadBytes).toEqual(
      new Uint8Array(new Float32Array([0, 1, 2, 3]).buffer),
    );
    expect(transport.sent[0]?.transfer).toHaveLength(1);
    await expect(first?.outcome).resolves.toBeDefined();
  });
});
