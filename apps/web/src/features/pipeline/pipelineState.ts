/**
 * F15 pipeline editor state: a versioned DSP graph plus pure, locale-free
 * editing/URL helpers. Structural validity comes from `validatePipeline`;
 * this module adds parameter checks so a share link can never dispatch a NaN
 * or out-of-range value to the worker.
 *
 * URL codec: `pg` is URL-safe base64 of UTF-8 JSON. Decoding is total: absent
 * input opens the default graph silently, while over-cap or malformed input
 * falls back to the default graph with a translated warning.
 */
import {
  PIPELINE_MAX_NODES,
  PIPELINE_MAX_OUTPUTS,
  type PipelineEdge,
  type PipelineGraph,
  type PipelineNode,
  type PipelineValidation,
  validatePipeline,
  type XY,
} from "@avalab/dsp";

import { type LastUsedStorage, readLastUsed } from "../../lib/lastUsed";
import { decodeParams, encodeParams } from "../../lib/url-state";
import type { CodecLabCodec } from "../../session/ops";

export type { PipelineEdge, PipelineGraph, PipelineNode, PipelineValidation };
export { PIPELINE_MAX_NODES, PIPELINE_MAX_OUTPUTS };

export const PIPELINE_URL_KEY = "pg";
export const PIPELINE_STORAGE_KEY = "avalab.pipeline.last";
export const PIPELINE_URL_MAX_CHARS = 8192;
export const PIPELINE_PREVIEW_SECONDS = 30;
export const PIPELINE_GRID_COLUMNS = 5;
export const PIPELINE_GRID_X = 220;
export const PIPELINE_GRID_Y = 140;
export const PIPELINE_NODE_KINDS = [
  "source",
  "resample",
  "filter",
  "quantize",
  "codec",
  "reverb",
  "reverse",
  "timeStretch",
  "output",
] as const;
export type PipelineNodeKind = (typeof PIPELINE_NODE_KINDS)[number];

export type PipelineWarning = "invalid" | "tooLong";
export type PipelineRange = { readonly startSample: number; readonly endSample: number };
export type PipelineState = {
  readonly graph: PipelineGraph;
  readonly selectedNodeId: string | null;
  readonly selectedEdgeId: string | null;
  readonly selectedOutputId: string | null;
  readonly validation: PipelineValidation;
};
export type PipelineDecodeResult = {
  readonly state: PipelineState;
  readonly warning: PipelineWarning | null;
};
export type PipelineEncodeResult = {
  readonly search: string;
  readonly warning: PipelineWarning | null;
};
export type PipelineParseResult =
  | { readonly ok: true; readonly graph: PipelineGraph }
  | { readonly ok: false; readonly code: "invalid" };

const CODECS: readonly CodecLabCodec[] = [
  "rle",
  "huffman",
  "deltaHuffman",
  "mulaw",
  "alaw",
  "mdct",
];
const IR_KINDS = ["room", "hall", "plate", "telephone"] as const;
const MAX_PARAM_ARRAY = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PARAM_ARRAY) {
    return null;
  }
  const numbers: number[] = [];
  for (const entry of value) {
    const number = finiteNumber(entry);
    if (number === null) {
      return null;
    }
    numbers.push(number);
  }
  return numbers;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function outputLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

export function defaultPipelineGraph(): PipelineGraph {
  return {
    version: 1,
    nodes: [
      {
        id: "source-1",
        kind: "source",
        params: {},
        position: { x: 80, y: 140 },
      },
      {
        id: "output-1",
        kind: "output",
        params: { label: "A" },
        position: { x: 520, y: 140 },
      },
    ],
    edges: [{ id: "edge-1", from: "source-1", to: "output-1" }],
  };
}

export function withPipelineValidation(state: {
  readonly graph: PipelineGraph;
  readonly selectedNodeId: string | null;
  readonly selectedEdgeId: string | null;
  readonly selectedOutputId: string | null;
}): PipelineState {
  return { ...state, validation: validatePipeline(state.graph) };
}

export function defaultPipelineState(): PipelineState {
  const graph = defaultPipelineGraph();
  return withPipelineValidation({
    graph,
    selectedNodeId: "source-1",
    selectedEdgeId: null,
    selectedOutputId: "output-1",
  });
}

function nextNodeId(graph: PipelineGraph, kind: PipelineNodeKind): string {
  const used = new Set(graph.nodes.map((node) => node.id));
  for (let index = 1; ; index += 1) {
    const candidate = `${kind}-${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

function nextEdgeId(graph: PipelineGraph): string {
  const used = new Set(graph.edges.map((edge) => edge.id));
  for (let index = 1; ; index += 1) {
    const candidate = `edge-${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

function gridPosition(index: number): XY {
  return {
    x: 80 + (index % PIPELINE_GRID_COLUMNS) * PIPELINE_GRID_X,
    y: 80 + Math.floor(index / PIPELINE_GRID_COLUMNS) * PIPELINE_GRID_Y,
  };
}

function freeGridPosition(graph: PipelineGraph): XY {
  const isOccupied = (candidate: XY): boolean =>
    graph.nodes.some(
      (node) =>
        Math.abs(node.position.x - candidate.x) < PIPELINE_GRID_X * 0.9 &&
        Math.abs(node.position.y - candidate.y) < PIPELINE_GRID_Y * 0.5,
    );
  for (let index = graph.nodes.length; index < graph.nodes.length + 200; index += 1) {
    const candidate = gridPosition(index);
    if (!isOccupied(candidate)) {
      return candidate;
    }
  }
  return gridPosition(graph.nodes.length);
}

export function createPipelineNode(
  kind: PipelineNodeKind,
  id: string,
  position: XY,
  outputIndex = 0,
): PipelineNode {
  switch (kind) {
    case "source":
      return { id, kind: "source", params: {}, position };
    case "resample":
      return {
        id,
        kind: "resample",
        params: { targetRateHz: 22_050, antiAlias: true },
        position,
      };
    case "filter":
      return {
        id,
        kind: "filter",
        params: {
          b: [0.25, 0.5, 0.25],
          a: [1],
          fir: true,
          sampleRateHz: 0,
          compensateDelay: false,
        },
        position,
      };
    case "quantize":
      return {
        id,
        kind: "quantize",
        params: { bits: 8, dither: false, seed: 1 },
        position,
      };
    case "codec":
      return {
        id,
        kind: "codec",
        params: {
          codec: "rle",
          mdctBitsPerSecond: 128_000,
          psychoacoustic: true,
          referenceSplDb: 94,
        },
        position,
      };
    case "reverb":
      return {
        id,
        kind: "reverb",
        params: {
          sampleRateHz: 0,
          startSample: 0,
          endSample: 0,
          ir: { kind: "hall", durationSeconds: 0.5, rt60Seconds: 0.6, seed: 1 },
          uploadedIrSampleCount: 0,
          preDelayMs: 0,
          wetMix: 0.3,
          method: "fft",
        },
        position,
      };
    case "reverse":
      return { id, kind: "reverse", params: {}, position };
    case "timeStretch":
      return {
        id,
        kind: "timeStretch",
        params: { speedFactor: 1.5, pitchSemitones: 0 },
        position,
      };
    case "output":
      return { id, kind: "output", params: { label: outputLabel(outputIndex) }, position };
  }
}

export function addPipelineNode(graph: PipelineGraph, kind: PipelineNodeKind): PipelineGraph {
  if (graph.nodes.length >= PIPELINE_MAX_NODES) {
    return graph;
  }
  if (kind === "source" && graph.nodes.some((node) => node.kind === "source")) {
    return graph;
  }
  const outputs = graph.nodes.filter((node) => node.kind === "output").length;
  if (kind === "output" && outputs >= PIPELINE_MAX_OUTPUTS) {
    return graph;
  }
  const id = nextNodeId(graph, kind);
  const node = createPipelineNode(
    kind,
    id,
    freeGridPosition(graph),
    kind === "output" ? outputs : 0,
  );
  return { ...graph, nodes: [...graph.nodes, node] };
}

function reaches(graph: PipelineGraph, fromId: string, toId: string): boolean {
  const stack = [fromId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) {
      continue;
    }
    if (current === toId) {
      return true;
    }
    seen.add(current);
    for (const edge of graph.edges) {
      if (edge.from === current) {
        stack.push(edge.to);
      }
    }
  }
  return false;
}

export function canConnectPipeline(graph: PipelineGraph, from: string, to: string): boolean {
  if (from === to) {
    return false;
  }
  const source = graph.nodes.find((node) => node.id === from);
  const target = graph.nodes.find((node) => node.id === to);
  if (source === undefined || target === undefined || target.kind === "source") {
    return false;
  }
  if (graph.edges.some((edge) => edge.to === to)) {
    return false;
  }
  return !reaches(graph, to, from);
}

export function connectPipelineNodes(
  graph: PipelineGraph,
  from: string,
  to: string,
): PipelineGraph {
  if (!canConnectPipeline(graph, from, to)) {
    return graph;
  }
  const edge: PipelineEdge = { id: nextEdgeId(graph), from, to };
  return { ...graph, edges: [...graph.edges, edge] };
}

export function deletePipelineNode(graph: PipelineGraph, nodeId: string): PipelineGraph {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) {
    return graph;
  }
  if (node.kind === "source" && graph.nodes.filter((n) => n.kind === "source").length <= 1) {
    return graph;
  }
  if (node.kind === "output" && graph.nodes.filter((n) => n.kind === "output").length <= 1) {
    return graph;
  }
  return {
    ...graph,
    nodes: graph.nodes.filter((candidate) => candidate.id !== nodeId),
    edges: graph.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
  };
}

export function deletePipelineEdge(graph: PipelineGraph, edgeId: string): PipelineGraph {
  return { ...graph, edges: graph.edges.filter((edge) => edge.id !== edgeId) };
}

export function replacePipelineNode(graph: PipelineGraph, node: PipelineNode): PipelineGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((candidate) => (candidate.id === node.id ? node : candidate)),
  };
}

export function updatePipelinePosition(
  graph: PipelineGraph,
  nodeId: string,
  position: XY,
): PipelineGraph {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return graph;
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === nodeId ? { ...node, position: { x: position.x, y: position.y } } : node,
    ),
  };
}

export function pipelineRunRange(
  selection: PipelineRange,
  sampleCount: number,
  sampleRateHz: number,
): PipelineRange {
  if (sampleCount <= 0 || !Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    return { startSample: 0, endSample: 0 };
  }
  const capSamples = Math.max(1, Math.round(PIPELINE_PREVIEW_SECONDS * sampleRateHz));
  const start = Math.max(0, Math.min(Math.round(selection.startSample), sampleCount));
  const end = Math.max(start, Math.min(Math.round(selection.endSample), sampleCount));
  if (end > start) {
    return { startSample: start, endSample: Math.min(end, start + capSamples) };
  }
  return { startSample: 0, endSample: Math.min(sampleCount, capSamples) };
}

export function pipelineNodeParamsError(node: PipelineNode): "badParams" | null {
  switch (node.kind) {
    case "source":
    case "reverse":
      return null;
    case "output":
      return typeof node.params.label === "string" ? null : "badParams";
    case "resample":
      return Number.isFinite(node.params.targetRateHz) &&
        node.params.targetRateHz > 0 &&
        node.params.targetRateHz <= 96_000 &&
        typeof node.params.antiAlias === "boolean"
        ? null
        : "badParams";
    case "filter":
      return node.params.b.length > 0 &&
        node.params.b.length <= MAX_PARAM_ARRAY &&
        node.params.a.length > 0 &&
        node.params.a.length <= MAX_PARAM_ARRAY &&
        node.params.b.every((value) => Number.isFinite(value)) &&
        node.params.a.every((value) => Number.isFinite(value)) &&
        typeof node.params.fir === "boolean" &&
        typeof node.params.compensateDelay === "boolean"
        ? null
        : "badParams";
    case "quantize":
      return Number.isInteger(node.params.bits) &&
        node.params.bits >= 1 &&
        node.params.bits <= 24 &&
        typeof node.params.dither === "boolean" &&
        Number.isFinite(node.params.seed)
        ? null
        : "badParams";
    case "codec":
      return CODECS.includes(node.params.codec) &&
        Number.isFinite(node.params.mdctBitsPerSecond) &&
        node.params.mdctBitsPerSecond >= 8_000 &&
        node.params.mdctBitsPerSecond <= 512_000 &&
        typeof node.params.psychoacoustic === "boolean" &&
        Number.isFinite(node.params.referenceSplDb) &&
        node.params.referenceSplDb >= 80 &&
        node.params.referenceSplDb <= 100
        ? null
        : "badParams";
    case "reverb":
      return IR_KINDS.includes(node.params.ir.kind) &&
        Number.isFinite(node.params.ir.durationSeconds) &&
        node.params.ir.durationSeconds > 0 &&
        Number.isFinite(node.params.ir.rt60Seconds) &&
        node.params.ir.rt60Seconds > 0 &&
        Number.isFinite(node.params.ir.seed) &&
        node.params.uploadedIrSampleCount === 0 &&
        Number.isFinite(node.params.preDelayMs) &&
        node.params.preDelayMs >= 0 &&
        Number.isFinite(node.params.wetMix) &&
        node.params.wetMix >= 0 &&
        node.params.wetMix <= 1 &&
        (node.params.method === "fft" || node.params.method === "direct")
        ? null
        : "badParams";
    case "timeStretch":
      return Number.isFinite(node.params.speedFactor) &&
        node.params.speedFactor >= 0.25 &&
        node.params.speedFactor <= 4 &&
        Number.isFinite(node.params.pitchSemitones) &&
        node.params.pitchSemitones >= -12 &&
        node.params.pitchSemitones <= 12
        ? null
        : "badParams";
  }
}

export function pipelineParamsError(
  graph: PipelineGraph,
): { readonly nodeId: string; readonly code: "badParams" } | null {
  for (const node of graph.nodes) {
    if (pipelineNodeParamsError(node) !== null) {
      return { nodeId: node.id, code: "badParams" };
    }
  }
  return null;
}

function parsePosition(value: unknown): XY | null {
  if (!isRecord(value)) {
    return null;
  }
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  return x === null || y === null ? null : { x, y };
}

function parseNode(value: unknown): PipelineNode | null {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    return null;
  }
  const position = parsePosition(value.position);
  if (position === null) {
    return null;
  }
  const params = isRecord(value.params) ? value.params : {};
  const id = value.id;
  switch (value.kind) {
    case "source":
      return { id, kind: "source", params: {}, position };
    case "reverse":
      return { id, kind: "reverse", params: {}, position };
    case "output":
      return typeof params.label === "string"
        ? { id, kind: "output", params: { label: params.label.slice(0, 200) }, position }
        : null;
    case "resample": {
      const targetRateHz = finiteNumber(params.targetRateHz);
      const antiAlias = booleanValue(params.antiAlias);
      return targetRateHz === null || antiAlias === null
        ? null
        : { id, kind: "resample", params: { targetRateHz, antiAlias }, position };
    }
    case "filter": {
      const b = finiteNumberArray(params.b);
      const a = finiteNumberArray(params.a);
      const fir = booleanValue(params.fir);
      const compensateDelay = booleanValue(params.compensateDelay);
      if (b === null || a === null || fir === null || compensateDelay === null) {
        return null;
      }
      const sampleRateHz = finiteNumber(params.sampleRateHz) ?? 0;
      return {
        id,
        kind: "filter",
        params: { b, a, fir, sampleRateHz, compensateDelay },
        position,
      };
    }
    case "quantize": {
      const bits = finiteNumber(params.bits);
      const dither = booleanValue(params.dither);
      const seed = finiteNumber(params.seed);
      return bits === null || dither === null || seed === null
        ? null
        : { id, kind: "quantize", params: { bits, dither, seed }, position };
    }
    case "codec": {
      const codec = params.codec;
      const mdctBitsPerSecond = finiteNumber(params.mdctBitsPerSecond);
      const psychoacoustic = booleanValue(params.psychoacoustic);
      const referenceSplDb = finiteNumber(params.referenceSplDb);
      return CODECS.includes(codec as CodecLabCodec) &&
        mdctBitsPerSecond !== null &&
        psychoacoustic !== null &&
        referenceSplDb !== null
        ? {
            id,
            kind: "codec",
            params: {
              codec: codec as CodecLabCodec,
              mdctBitsPerSecond,
              psychoacoustic,
              referenceSplDb,
            },
            position,
          }
        : null;
    }
    case "reverb": {
      const irValue = params.ir;
      if (!isRecord(irValue)) {
        return null;
      }
      const durationSeconds = finiteNumber(irValue.durationSeconds);
      const rt60Seconds = finiteNumber(irValue.rt60Seconds);
      const seed = finiteNumber(irValue.seed);
      const preDelayMs = finiteNumber(params.preDelayMs);
      const wetMix = finiteNumber(params.wetMix);
      const sampleRateHz = finiteNumber(params.sampleRateHz) ?? 0;
      const startSample = finiteNumber(params.startSample) ?? 0;
      const endSample = finiteNumber(params.endSample) ?? 0;
      const uploadedIrSampleCount = finiteNumber(params.uploadedIrSampleCount) ?? 0;
      const method = params.method;
      if (
        !IR_KINDS.includes(irValue.kind as (typeof IR_KINDS)[number]) ||
        durationSeconds === null ||
        rt60Seconds === null ||
        seed === null ||
        preDelayMs === null ||
        wetMix === null ||
        (method !== "fft" && method !== "direct")
      ) {
        return null;
      }
      return {
        id,
        kind: "reverb",
        params: {
          sampleRateHz,
          startSample,
          endSample,
          ir: {
            kind: irValue.kind as (typeof IR_KINDS)[number],
            durationSeconds,
            rt60Seconds,
            seed,
          },
          uploadedIrSampleCount,
          preDelayMs,
          wetMix,
          method,
        },
        position,
      };
    }
    case "timeStretch": {
      const speedFactor = finiteNumber(params.speedFactor);
      const pitchSemitones = finiteNumber(params.pitchSemitones);
      return speedFactor === null || pitchSemitones === null
        ? null
        : { id, kind: "timeStretch", params: { speedFactor, pitchSemitones }, position };
    }
    default:
      return null;
  }
}

export function parsePipelineGraphValue(value: unknown): PipelineGraph | null {
  if (!isRecord(value) || value.version !== 1) {
    return null;
  }
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return null;
  }
  if (value.nodes.length === 0 || value.nodes.length > PIPELINE_MAX_NODES) {
    return null;
  }
  const nodes: PipelineNode[] = [];
  for (const entry of value.nodes) {
    const node = parseNode(entry);
    if (node === null || pipelineNodeParamsError(node) !== null) {
      return null;
    }
    nodes.push(node);
  }
  const edges: PipelineEdge[] = [];
  for (const entry of value.edges) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      entry.id.length === 0 ||
      typeof entry.from !== "string" ||
      typeof entry.to !== "string"
    ) {
      return null;
    }
    edges.push({ id: entry.id, from: entry.from, to: entry.to });
  }
  const graph: PipelineGraph = { version: 1, nodes, edges };
  return validatePipeline(graph).ok ? graph : null;
}

export function pipelineGraphToJson(graph: PipelineGraph): string {
  return JSON.stringify(graph);
}

export function pipelineGraphFromJson(text: string): PipelineParseResult {
  if (text.length > 1_000_000) {
    return { ok: false, code: "invalid" };
  }
  try {
    const graph = parsePipelineGraphValue(JSON.parse(text) as unknown);
    return graph === null ? { ok: false, code: "invalid" } : { ok: true, graph };
  } catch {
    return { ok: false, code: "invalid" };
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error("invalid base64url");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return new TextDecoder("utf-8", { fatal: true }).decode(base64ToBytes(padded));
}

export function encodePipelineState(state: PipelineState): PipelineEncodeResult {
  const encoded = encodeBase64Url(pipelineGraphToJson(state.graph));
  if (encoded.length > PIPELINE_URL_MAX_CHARS) {
    return { search: "", warning: "tooLong" };
  }
  return { search: encodeParams({ [PIPELINE_URL_KEY]: encoded }), warning: null };
}

export function pipelineStateToSearch(state: PipelineState): string {
  return encodePipelineState(state).search;
}

export function pipelineStateFromSearch(search: string): PipelineDecodeResult {
  const decoded = decodeParams(search);
  const raw = decoded[PIPELINE_URL_KEY];
  if (raw === undefined) {
    return { state: defaultPipelineState(), warning: null };
  }
  if (typeof raw !== "string") {
    return { state: defaultPipelineState(), warning: "invalid" };
  }
  if (raw.length > PIPELINE_URL_MAX_CHARS) {
    return { state: defaultPipelineState(), warning: "tooLong" };
  }
  try {
    const graph = parsePipelineGraphValue(JSON.parse(decodeBase64Url(raw)) as unknown);
    if (graph === null) {
      return { state: defaultPipelineState(), warning: "invalid" };
    }
    const source = graph.nodes.find((node) => node.kind === "source");
    const output = graph.nodes.find((node) => node.kind === "output");
    return {
      state: withPipelineValidation({
        graph,
        selectedNodeId: source?.id ?? null,
        selectedEdgeId: null,
        selectedOutputId: output?.id ?? null,
      }),
      warning: null,
    };
  } catch {
    return { state: defaultPipelineState(), warning: "invalid" };
  }
}

/** Last-used graph; missing/invalid storage returns the validated default. */
export function loadPipelineState(storage?: LastUsedStorage | null): PipelineDecodeResult {
  const stored = readLastUsed(PIPELINE_STORAGE_KEY, storage);
  return stored === null ? pipelineStateFromSearch("") : pipelineStateFromSearch(stored);
}
