/**
 * Purpose: pure execution engine for the F15 pipeline DAG.
 *
 * Execution order: validate the graph, then run a stable topological order
 * (source first, ties broken by node array order). Every node runs once;
 * fan-out shares the cached upstream value, which is released with the run.
 *
 * Node formulas:
 *   resample     resampleRational(x, min(fs_in, fs_out)/2 low-pass when
 *                antiAlias; nearest-sample otherwise)
 *   filter       FIR: convolveFft + optional group-delay trim;
 *                IIR: transposed direct-form II applyFilter
 *   quantize     uniform or TPDF-dithered uniform quantizer
 *   codec        same codec primitives as the F04 lab, decode-only here
 *   reverb       synthetic IR convolution + pre-delay + wet/dry mix
 *   reverse      x[N-1-n]
 *   timeStretch  phase vocoder stretch (1/speed) then optional pitch shift
 *
 * The engine returns only summaries and concatenated output PCM. Intermediate
 * buffers stay local to the run and are never included in the result, so the
 * caller cannot accidentally transfer a full intermediate graph over the
 * worker boundary.
 *
 * Complexity: O(sum of node costs + V + E); V is capped at 24 by validation.
 *
 * Edge cases: invalid graphs throw PipelineRunError before any DSP; empty or
 * non-finite source data throws TypeError/RangeError; envelope buckets must be
 * a positive integer. Outputs are concatenated in node-array order, not
 * execution order, so the reported offsets are deterministic.
 */

import { decodeLosslessDeltaHuffman, encodeLosslessDeltaHuffman } from "../codecs/delta.js";
import { huffmanDecode, huffmanEncode } from "../codecs/huffman.js";
import { decodeMdct, encodeMdct } from "../codecs/mdctCodec.js";
import { decodeMdctPsycho, encodeMdctPsycho } from "../codecs/mdctPsycho.js";
import {
  bytesToInt16Pcm,
  floatToInt16Pcm,
  int16PcmToBytes,
  int16PcmToFloat,
} from "../codecs/pcmWav.js";
import { rleDecode, rleEncode } from "../codecs/rle.js";
import { applyFilter } from "../filters/iir.js";
import { alawDecode, alawEncode, mulawDecode, mulawEncode } from "../metrics/companding.js";
import { quantizeUniform, quantizeWithTpdfDither } from "../metrics/quantize.js";
import { resampleRational } from "../resample/resample.js";
import { reverse } from "../signals/extent.js";
import { convolveFft } from "../systems/convolution.js";
import { generateSyntheticIr } from "../systems/impulseResponse.js";
import { pitchShift, timeStretch } from "../timestretch/phaseVocoder.js";
import type { PipelineGraph, PipelineNode } from "./types.js";
import { type PipelineErrorCode, validatePipeline } from "./validate.js";

const DEFAULT_ENVELOPE_BUCKETS = 200;
const TIME_STRETCH_WINDOW_SAMPLES = 2048;
const CODEC_MDCT_FRAME_LENGTH = 512;
const PSYCHO_MIN_SPL_DB = 80;
const PSYCHO_MAX_SPL_DB = 100;
const REVERB_MAX_OUTPUT_SECONDS = 300;
const REVERB_MAX_DIRECT_INPUT_SECONDS = 2;

export interface PipelineStageSummary {
  readonly nodeId: string;
  readonly kind: PipelineNode["kind"];
  readonly sampleCount: number;
  readonly sampleRateHz: number;
  readonly durationSeconds: number;
  readonly peak: number;
  readonly rms: number;
  readonly elapsedMs: number;
  readonly envelope: Float32Array;
}

export interface PipelineOutput {
  readonly nodeId: string;
  readonly label: string;
  readonly sampleCount: number;
  readonly sampleRateHz: number;
  readonly offsetSamples: number;
}

export interface PipelineRunResult {
  readonly stages: readonly PipelineStageSummary[];
  readonly outputs: readonly PipelineOutput[];
  readonly samples: Float32Array;
  readonly totalElapsedMs: number;
}

export class PipelineRunError extends Error {
  readonly code: PipelineErrorCode;

  constructor(code: PipelineErrorCode) {
    super(`pipeline: invalid graph (${code})`);
    this.name = "PipelineRunError";
    this.code = code;
  }
}

interface NodeValue {
  readonly samples: Float32Array;
  readonly sampleRateHz: number;
}

function assertFiniteInput(samples: Float32Array, sampleRateHz: number): void {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError(`runPipeline: sampleRateHz must be finite and > 0 (got ${sampleRateHz})`);
  }
  if (samples.length === 0) {
    throw new RangeError("runPipeline: the source excerpt is empty");
  }
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample === undefined || !Number.isFinite(sample)) {
      throw new TypeError(`runPipeline: samples[${index}] must be finite`);
    }
  }
}

function buildEnvelope(samples: Float32Array, buckets: number): Float32Array {
  const envelope = new Float32Array(buckets * 2);
  if (samples.length === 0) {
    return envelope;
  }
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = Math.floor((bucket * samples.length) / buckets);
    const end = Math.floor(((bucket + 1) * samples.length) / buckets);
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    for (let index = start; index < end; index += 1) {
      const sample = samples[index] ?? 0;
      if (sample < minimum) {
        minimum = sample;
      }
      if (sample > maximum) {
        maximum = sample;
      }
    }
    if (minimum === Number.POSITIVE_INFINITY) {
      minimum = 0;
      maximum = 0;
    }
    envelope[bucket * 2] = minimum;
    envelope[bucket * 2 + 1] = maximum;
  }
  return envelope;
}

function peakAndRms(samples: Float32Array): { peak: number; rms: number } {
  if (samples.length === 0) {
    return { peak: 0, rms: 0 };
  }
  let peak = 0;
  let energy = 0;
  for (const sample of samples) {
    const magnitude = Math.abs(sample);
    if (magnitude > peak) {
      peak = magnitude;
    }
    energy += sample * sample;
  }
  return { peak, rms: Math.sqrt(energy / samples.length) };
}

function summarize(
  node: PipelineNode,
  value: NodeValue,
  elapsedMs: number,
  buckets: number,
): PipelineStageSummary {
  const { peak, rms } = peakAndRms(value.samples);
  return {
    nodeId: node.id,
    kind: node.kind,
    sampleCount: value.samples.length,
    sampleRateHz: value.sampleRateHz,
    durationSeconds: value.samples.length / value.sampleRateHz,
    peak,
    rms,
    elapsedMs,
    envelope: buildEnvelope(value.samples, buckets),
  };
}

function topologicalOrder(graph: PipelineGraph): PipelineNode[] {
  const indexById = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of graph.edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const ready = graph.nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  const ordered: PipelineNode[] = [];
  while (ready.length > 0) {
    ready.sort((left, right) => (indexById.get(left) ?? 0) - (indexById.get(right) ?? 0));
    const nodeId = ready.shift();
    if (nodeId === undefined) {
      break;
    }
    const node = graph.nodes[indexById.get(nodeId) ?? -1];
    if (node === undefined) {
      throw new PipelineRunError("unknownEndpoint");
    }
    ordered.push(node);
    for (const target of outgoing.get(nodeId) ?? []) {
      const next = (incoming.get(target) ?? 0) - 1;
      incoming.set(target, next);
      if (next === 0) {
        ready.push(target);
      }
    }
  }
  if (ordered.length !== graph.nodes.length) {
    throw new PipelineRunError("cycle");
  }
  return ordered;
}

function runResample(
  input: NodeValue,
  params: Extract<PipelineNode, { kind: "resample" }>["params"],
): NodeValue {
  return {
    samples: Float32Array.from(
      resampleRational(Float64Array.from(input.samples), {
        inputRateHz: input.sampleRateHz,
        outputRateHz: params.targetRateHz,
        filter: params.antiAlias ? "kaiserSinc" : "none",
      }),
    ),
    sampleRateHz: params.targetRateHz,
  };
}

function runFilter(
  input: NodeValue,
  params: Extract<PipelineNode, { kind: "filter" }>["params"],
): NodeValue {
  const b = Float64Array.from(params.b);
  const input64 = Float64Array.from(input.samples);
  if (params.fir) {
    const full = convolveFft(input64, b);
    if (!params.compensateDelay) {
      return { samples: Float32Array.from(full), sampleRateHz: input.sampleRateHz };
    }
    const delaySamples = Math.floor((b.length - 1) / 2);
    return {
      samples: Float32Array.from(full.subarray(delaySamples, delaySamples + input64.length)),
      sampleRateHz: input.sampleRateHz,
    };
  }
  const a = Float64Array.from(params.a);
  return {
    samples: Float32Array.from(applyFilter(input64, { b, a })),
    sampleRateHz: input.sampleRateHz,
  };
}

function runQuantize(
  input: NodeValue,
  params: Extract<PipelineNode, { kind: "quantize" }>["params"],
): NodeValue {
  const input64 = Float64Array.from(input.samples);
  const quantized = params.dither
    ? quantizeWithTpdfDither(input64, { bits: params.bits, seed: params.seed })
    : quantizeUniform(input64, { bits: params.bits });
  return { samples: Float32Array.from(quantized), sampleRateHz: input.sampleRateHz };
}

function runCodec(
  input: NodeValue,
  params: Extract<PipelineNode, { kind: "codec" }>["params"],
): NodeValue {
  if (
    !Number.isFinite(params.mdctBitsPerSecond) ||
    params.mdctBitsPerSecond < 8_000 ||
    params.mdctBitsPerSecond > 512_000
  ) {
    throw new RangeError("runPipeline: codec bitrate must be in [8000, 512000] bit/s");
  }
  if (
    !Number.isFinite(params.referenceSplDb) ||
    params.referenceSplDb < PSYCHO_MIN_SPL_DB ||
    params.referenceSplDb > PSYCHO_MAX_SPL_DB
  ) {
    throw new RangeError(
      `runPipeline: codec referenceSplDb must be in [${PSYCHO_MIN_SPL_DB}, ${PSYCHO_MAX_SPL_DB}]`,
    );
  }

  const pcm16 = floatToInt16Pcm(input.samples);
  const reference = int16PcmToFloat(pcm16);
  let decoded: Float32Array;
  if (params.codec === "rle") {
    decoded = int16PcmToFloat(bytesToInt16Pcm(rleDecode(rleEncode(int16PcmToBytes(pcm16)))));
  } else if (params.codec === "huffman") {
    const encoded = huffmanEncode(int16PcmToBytes(pcm16));
    decoded = int16PcmToFloat(
      bytesToInt16Pcm(huffmanDecode(encoded.bits, encoded.bitLength, encoded.codebook)),
    );
  } else if (params.codec === "deltaHuffman") {
    const encoded = encodeLosslessDeltaHuffman(pcm16);
    decoded = int16PcmToFloat(decodeLosslessDeltaHuffman(encoded.payload).samples);
  } else if (params.codec === "mulaw" || params.codec === "alaw") {
    const encode = params.codec === "mulaw" ? mulawEncode : alawEncode;
    const decode = params.codec === "mulaw" ? mulawDecode : alawDecode;
    decoded = Float32Array.from(decode(encode(Float64Array.from(reference), { bits: 8 })));
  } else if (params.codec === "mdct") {
    if (params.psychoacoustic) {
      const encoded = encodeMdctPsycho(reference, {
        sampleRateHz: input.sampleRateHz,
        frameLengthSamples: CODEC_MDCT_FRAME_LENGTH,
        bitsPerSecond: params.mdctBitsPerSecond,
        referenceSplDb: params.referenceSplDb,
      });
      decoded = decodeMdctPsycho(encoded, {
        sampleRateHz: input.sampleRateHz,
        frameLengthSamples: CODEC_MDCT_FRAME_LENGTH,
      }).slice(0, input.samples.length);
    } else {
      const encoded = encodeMdct(reference, {
        sampleRateHz: input.sampleRateHz,
        frameLengthSamples: CODEC_MDCT_FRAME_LENGTH,
        bitsPerSecond: params.mdctBitsPerSecond,
      });
      decoded = decodeMdct(encoded, {
        sampleRateHz: input.sampleRateHz,
        frameLengthSamples: CODEC_MDCT_FRAME_LENGTH,
      }).slice(0, input.samples.length);
    }
  } else {
    throw new RangeError(`runPipeline: unknown codec ${String(params.codec)}`);
  }
  return { samples: decoded, sampleRateHz: input.sampleRateHz };
}

function runReverb(
  input: NodeValue,
  params: Extract<PipelineNode, { kind: "reverb" }>["params"],
): NodeValue {
  if (params.uploadedIrSampleCount !== 0) {
    throw new RangeError("runPipeline: reverb nodes only support synthetic impulse responses");
  }
  if (
    !Number.isFinite(params.preDelayMs) ||
    params.preDelayMs < 0 ||
    !Number.isFinite(params.wetMix) ||
    params.wetMix < 0 ||
    params.wetMix > 1
  ) {
    throw new RangeError("runPipeline: invalid reverb pre-delay or wet mix");
  }
  if (
    params.method === "direct" &&
    input.samples.length / input.sampleRateHz > REVERB_MAX_DIRECT_INPUT_SECONDS
  ) {
    throw new RangeError(
      `runPipeline: direct reverb is limited to ${REVERB_MAX_DIRECT_INPUT_SECONDS} s excerpts`,
    );
  }

  const preDelaySamples = Math.round((params.preDelayMs * input.sampleRateHz) / 1000);
  const impulse = generateSyntheticIr({
    kind: params.ir.kind,
    sampleRateHz: input.sampleRateHz,
    durationSeconds: params.ir.durationSeconds,
    rt60Seconds: params.ir.rt60Seconds,
    seed: params.ir.seed,
  });
  const outputLength = preDelaySamples + input.samples.length + impulse.length - 1;
  if (
    !Number.isSafeInteger(outputLength) ||
    outputLength / input.sampleRateHz > REVERB_MAX_OUTPUT_SECONDS
  ) {
    throw new RangeError(`runPipeline: reverb output exceeds ${REVERB_MAX_OUTPUT_SECONDS} s`);
  }

  const delayed = new Float64Array(preDelaySamples + input.samples.length);
  delayed.set(input.samples, preDelaySamples);
  const wet = convolveFft(delayed, impulse);
  const output = new Float64Array(wet.length);
  for (let index = 0; index < output.length; index += 1) {
    const dry = index < input.samples.length ? (input.samples[index] ?? 0) : 0;
    output[index] = (1 - params.wetMix) * dry + params.wetMix * (wet[index] ?? 0);
  }
  return { samples: Float32Array.from(output), sampleRateHz: input.sampleRateHz };
}

function runTimeStretch(
  input: NodeValue,
  params: Extract<PipelineNode, { kind: "timeStretch" }>["params"],
): NodeValue {
  if (
    !Number.isFinite(params.speedFactor) ||
    params.speedFactor < 0.25 ||
    params.speedFactor > 4 ||
    !Number.isFinite(params.pitchSemitones) ||
    params.pitchSemitones < -12 ||
    params.pitchSemitones > 12
  ) {
    throw new RangeError("runPipeline: time-stretch speed/semitones are out of range");
  }
  if (params.speedFactor === 1 && params.pitchSemitones === 0) {
    return input;
  }
  let output = timeStretch(Float64Array.from(input.samples), {
    stretchFactor: 1 / params.speedFactor,
    windowLengthSamples: TIME_STRETCH_WINDOW_SAMPLES,
  });
  if (params.pitchSemitones !== 0) {
    output = pitchShift(output, {
      semitones: params.pitchSemitones,
      windowLengthSamples: TIME_STRETCH_WINDOW_SAMPLES,
      sampleRateHz: input.sampleRateHz,
    });
  }
  return { samples: Float32Array.from(output), sampleRateHz: input.sampleRateHz };
}

function runNode(node: PipelineNode, input: NodeValue | null): NodeValue {
  if (node.kind === "source") {
    if (input === null) {
      throw new PipelineRunError("noSource");
    }
    return input;
  }
  if (input === null) {
    throw new PipelineRunError("disconnected");
  }
  switch (node.kind) {
    case "resample":
      return runResample(input, node.params);
    case "filter":
      return runFilter(input, node.params);
    case "quantize":
      return runQuantize(input, node.params);
    case "codec":
      return runCodec(input, node.params);
    case "reverb":
      return runReverb(input, node.params);
    case "reverse":
      return {
        samples: Float32Array.from(reverse(input.samples)),
        sampleRateHz: input.sampleRateHz,
      };
    case "timeStretch":
      return runTimeStretch(input, node.params);
    case "output":
      return input;
  }
}

export function runPipeline(
  samples: Float32Array,
  sampleRateHz: number,
  graph: PipelineGraph,
  options?: { readonly envelopeBuckets?: number },
): PipelineRunResult {
  const validation = validatePipeline(graph);
  if (!validation.ok) {
    throw new PipelineRunError(validation.code);
  }
  const buckets = options?.envelopeBuckets ?? DEFAULT_ENVELOPE_BUCKETS;
  if (!Number.isInteger(buckets) || buckets <= 0) {
    throw new RangeError("runPipeline: envelopeBuckets must be a positive integer");
  }
  assertFiniteInput(samples, sampleRateHz);

  const startedAt = performance.now();
  const order = topologicalOrder(graph);
  const values = new Map<string, NodeValue>();
  const stages: PipelineStageSummary[] = [];
  for (const node of order) {
    const nodeStarted = performance.now();
    let incoming: NodeValue | null = node.kind === "source" ? { samples, sampleRateHz } : null;
    if (node.kind !== "source") {
      const edge = graph.edges.find((candidate) => candidate.to === node.id);
      if (edge === undefined) {
        throw new PipelineRunError("disconnected");
      }
      incoming = values.get(edge.from) ?? null;
    }
    const value = runNode(node, incoming);
    values.set(node.id, value);
    stages.push(summarize(node, value, performance.now() - nodeStarted, buckets));
  }

  const outputs: PipelineOutput[] = [];
  const outputPcm: Float32Array[] = [];
  let offsetSamples = 0;
  for (const node of graph.nodes) {
    if (node.kind !== "output") {
      continue;
    }
    const value = values.get(node.id);
    if (value === undefined) {
      throw new PipelineRunError("disconnected");
    }
    outputs.push({
      nodeId: node.id,
      label: node.params.label,
      sampleCount: value.samples.length,
      sampleRateHz: value.sampleRateHz,
      offsetSamples,
    });
    outputPcm.push(value.samples);
    offsetSamples += value.samples.length;
  }
  if (!Number.isSafeInteger(offsetSamples)) {
    throw new RangeError("runPipeline: concatenated output is too large");
  }
  const concatenated = new Float32Array(offsetSamples);
  let cursor = 0;
  for (const chunk of outputPcm) {
    concatenated.set(chunk, cursor);
    cursor += chunk.length;
  }

  return {
    stages,
    outputs,
    samples: concatenated,
    totalElapsedMs: performance.now() - startedAt,
  };
}
