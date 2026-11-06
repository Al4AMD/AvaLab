import { describe, expect, it } from "vitest";

import { encodeParams } from "../../lib/url-state";
import {
  addPipelineNode,
  canConnectPipeline,
  connectPipelineNodes,
  defaultPipelineGraph,
  defaultPipelineState,
  deletePipelineEdge,
  deletePipelineNode,
  encodePipelineState,
  pipelineGraphFromJson,
  pipelineGraphToJson,
  pipelineNodeParamsError,
  pipelineParamsError,
  pipelineRunRange,
  pipelineStateFromSearch,
  pipelineStateToSearch,
  replacePipelineNode,
  updatePipelinePosition,
  withPipelineValidation,
} from "./pipelineState";

function validFilterChain() {
  const state = defaultPipelineState();
  let graph = addPipelineNode(state.graph, "filter");
  graph = connectPipelineNodes(graph, "source-1", "filter-1");
  graph = deletePipelineEdge(graph, "edge-1");
  graph = connectPipelineNodes(graph, "filter-1", "output-1");
  return graph;
}

describe("pipeline graph editing", () => {
  it("adds nodes at stable grid positions and caps outputs at two", () => {
    const first = addPipelineNode(defaultPipelineGraph(), "output");
    const second = addPipelineNode(first, "output");
    const third = addPipelineNode(second, "output");

    expect(second.nodes.map((node) => node.id)).toContain("output-2");
    expect(third.nodes.filter((node) => node.kind === "output")).toHaveLength(2);
    const added = first.nodes.find((node) => node.id === "output-2");
    expect(added?.position).toEqual({ x: 740, y: 80 });
  });

  it("adds no second source and no node beyond the 24-node cap", () => {
    const withSource = addPipelineNode(defaultPipelineGraph(), "source");
    expect(withSource.nodes.filter((node) => node.kind === "source")).toHaveLength(1);

    let graph = defaultPipelineGraph();
    while (graph.nodes.length < 24) {
      graph = addPipelineNode(graph, "reverse");
    }
    expect(addPipelineNode(graph, "reverse").nodes).toHaveLength(24);
  });

  it("connects a detached node and updates validation", () => {
    const detached = addPipelineNode(defaultPipelineGraph(), "filter");
    expect(
      withPipelineValidation({
        graph: detached,
        selectedNodeId: "filter-1",
        selectedEdgeId: null,
        selectedOutputId: "output-1",
      }).validation,
    ).toEqual({ ok: false, code: "disconnected", nodeId: "filter-1" });

    const connected = connectPipelineNodes(detached, "source-1", "filter-1");
    const rewired = connectPipelineNodes(
      deletePipelineEdge(connected, "edge-1"),
      "filter-1",
      "output-1",
    );
    const validation = withPipelineValidation({
      graph: rewired,
      selectedNodeId: "filter-1",
      selectedEdgeId: null,
      selectedOutputId: "output-1",
    }).validation;
    expect(validation).toEqual({ ok: true });
  });

  it("rejects a second incoming edge", () => {
    const graph = validFilterChain();
    expect(canConnectPipeline(graph, "source-1", "output-1")).toBe(false);
    expect(connectPipelineNodes(graph, "source-1", "output-1")).toBe(graph);
  });

  it("deletes edges and nodes without removing the last source or output", () => {
    const graph = validFilterChain();
    expect(deletePipelineNode(graph, "source-1")).toBe(graph);
    expect(deletePipelineNode(graph, "output-1")).toBe(graph);

    const withoutFilter = deletePipelineNode(graph, "filter-1");
    expect(withoutFilter.nodes.map((node) => node.id)).toEqual(["source-1", "output-1"]);
    expect(withoutFilter.edges).toEqual([]);
  });

  it("keeps positions finite and replaces typed node params", () => {
    const graph = validFilterChain();
    expect(updatePipelinePosition(graph, "filter-1", { x: Number.NaN, y: 0 })).toBe(graph);
    const moved = updatePipelinePosition(graph, "filter-1", { x: 42, y: 24 });
    expect(moved.nodes.find((node) => node.id === "filter-1")?.position).toEqual({ x: 42, y: 24 });

    const filter = moved.nodes.find((node) => node.id === "filter-1");
    expect(filter?.kind).toBe("filter");
    if (filter?.kind !== "filter") {
      return;
    }
    const replaced = replacePipelineNode(moved, {
      ...filter,
      params: { ...filter.params, compensateDelay: true },
    });
    expect(
      replaced.nodes.find((node) => node.id === "filter-1" && node.kind === "filter"),
    ).toMatchObject({ params: { compensateDelay: true } });
  });
});

describe("pipeline validation helpers", () => {
  it("flags out-of-range node params before dispatch", () => {
    const graph = addPipelineNode(defaultPipelineGraph(), "quantize");
    const quantization = graph.nodes.find((node) => node.id === "quantize-1");
    expect(quantization).toBeDefined();
    if (quantization?.kind !== "quantize") {
      return;
    }
    expect(pipelineNodeParamsError(quantization)).toBeNull();
    const invalid = { ...quantization, params: { ...quantization.params, bits: 99 } };
    expect(pipelineNodeParamsError(invalid)).toBe("badParams");
    expect(
      pipelineParamsError({
        ...graph,
        nodes: graph.nodes.map((n) => (n.id === invalid.id ? invalid : n)),
      }),
    ).toEqual({ nodeId: "quantize-1", code: "badParams" });
  });

  it("caps the run range at 30 seconds and prefers a real selection", () => {
    expect(pipelineRunRange({ startSample: 0, endSample: 0 }, 800_000, 8_000)).toEqual({
      startSample: 0,
      endSample: 240_000,
    });
    expect(pipelineRunRange({ startSample: 10, endSample: 800_000 }, 800_000, 8_000)).toEqual({
      startSample: 10,
      endSample: 240_010,
    });
    expect(pipelineRunRange({ startSample: 0, endSample: 0 }, 0, 48_000)).toEqual({
      startSample: 0,
      endSample: 0,
    });
  });
});

describe("pipeline URL and JSON codec", () => {
  it("round-trips a graph with unicode labels and positions", () => {
    let graph = validFilterChain();
    const output = graph.nodes.find((node) => node.id === "output-1");
    if (output?.kind === "output") {
      graph = replacePipelineNode(graph, { ...output, params: { label: "خروجی" } });
    }
    graph = updatePipelinePosition(graph, "filter-1", { x: 333.5, y: -12 });
    const state = withPipelineValidation({
      graph,
      selectedNodeId: "filter-1",
      selectedEdgeId: null,
      selectedOutputId: "output-1",
    });
    const decoded = pipelineStateFromSearch(`?${pipelineStateToSearch(state)}`);

    expect(decoded.warning).toBeNull();
    expect(decoded.state.graph).toEqual(graph);
    expect(decoded.state.validation).toEqual({ ok: true });
    expect(decoded.state.selectedNodeId).toBe("source-1");
  });

  it("falls back to the default graph for malformed input", () => {
    const decoded = pipelineStateFromSearch(`?${encodeParams({ pg: "%%%" })}`);
    expect(decoded.warning).toBe("invalid");
    expect(decoded.state.graph).toEqual(defaultPipelineGraph());
  });

  it("falls back for an over-cap encoded value", () => {
    const decoded = pipelineStateFromSearch(`?${encodeParams({ pg: "A".repeat(8193) })}`);
    expect(decoded.warning).toBe("tooLong");
    expect(decoded.state.graph).toEqual(defaultPipelineGraph());
  });

  it("falls back for structurally invalid JSON in the URL", () => {
    const json = JSON.stringify({ version: 1, nodes: [], edges: [] });
    const encoded = btoa(json).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    const decoded = pipelineStateFromSearch(`?${encodeParams({ pg: encoded })}`);
    expect(decoded.warning).toBe("invalid");
    expect(decoded.state.graph).toEqual(defaultPipelineGraph());
  });

  it("omits an over-cap graph from the URL instead of truncating it", () => {
    const graph = defaultPipelineGraph();
    const output = graph.nodes.find((node) => node.id === "output-1");
    if (output?.kind !== "output") {
      return;
    }
    const huge = replacePipelineNode(graph, {
      ...output,
      params: { label: "x".repeat(10_000) },
    });
    const encoded = encodePipelineState(
      withPipelineValidation({
        graph: huge,
        selectedNodeId: null,
        selectedEdgeId: null,
        selectedOutputId: null,
      }),
    );
    expect(encoded).toEqual({ search: "", warning: "tooLong" });
  });

  it("round-trips the save-file JSON and rejects malformed files", () => {
    const graph = validFilterChain();
    const parsed = pipelineGraphFromJson(pipelineGraphToJson(graph));
    expect(parsed).toEqual({ ok: true, graph });
    expect(pipelineGraphFromJson("{")).toEqual({ ok: false, code: "invalid" });
    expect(pipelineGraphFromJson(JSON.stringify({ version: 1, nodes: [], edges: [] }))).toEqual({
      ok: false,
      code: "invalid",
    });
  });
});
