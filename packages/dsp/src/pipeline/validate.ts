/**
 * Purpose: structural validation for the F15 pipeline DAG.
 *
 * Rules: one source, at least one output, every non-source has exactly one
 * incoming edge, no cycles, every node reachable from the source, at most 24
 * nodes and 2 outputs, finite positions, unique non-empty IDs, and no self or
 * dangling edges.
 *
 * Complexity: O(V + E), bounded by the 24-node cap.
 *
 * Edge cases: the first violation in a stable rule order wins, so a JSON
 * graph always yields one deterministic code. Cycle detection runs before the
 * merge rule because a reachable cycle necessarily gives its entry node two
 * incoming edges; reporting `cycle` is the more useful teaching signal.
 */

import {
  PIPELINE_MAX_NODES,
  PIPELINE_MAX_OUTPUTS,
  type PipelineGraph,
  type PipelineNode,
} from "./types.js";

export type PipelineErrorCode =
  | "badVersion"
  | "duplicateNodeId"
  | "duplicateEdgeId"
  | "emptyNodeId"
  | "emptyEdgeId"
  | "noSource"
  | "multipleSources"
  | "noOutput"
  | "cycle"
  | "merge"
  | "disconnected"
  | "tooManyNodes"
  | "tooManyOutputs"
  | "badPosition"
  | "unknownEndpoint"
  | "selfEdge";

export type PipelineValidation =
  | { ok: true }
  | { ok: false; code: PipelineErrorCode; nodeId?: string; edgeId?: string };

function fail(
  code: PipelineErrorCode,
  ids: { nodeId?: string; edgeId?: string } = {},
): PipelineValidation {
  return { ok: false, code, ...ids };
}

function hasCycle(
  nodes: readonly PipelineNode[],
  adjacency: ReadonlyMap<string, readonly string[]>,
): string | null {
  const state = new Map<string, "visiting" | "done">();
  let cycleNode: string | null = null;

  const visit = (nodeId: string): boolean => {
    const current = state.get(nodeId);
    if (current === "visiting") {
      cycleNode = nodeId;
      return true;
    }
    if (current === "done") {
      return false;
    }
    state.set(nodeId, "visiting");
    for (const target of adjacency.get(nodeId) ?? []) {
      if (visit(target)) {
        return true;
      }
    }
    state.set(nodeId, "done");
    return false;
  };

  for (const node of nodes) {
    if (visit(node.id)) {
      return cycleNode;
    }
  }
  return null;
}

export function validatePipeline(graph: PipelineGraph): PipelineValidation {
  const candidate = graph as Partial<PipelineGraph> | null;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    candidate.version !== 1 ||
    !Array.isArray(candidate.nodes) ||
    !Array.isArray(candidate.edges)
  ) {
    return fail("badVersion");
  }
  const { nodes, edges } = candidate;

  if (nodes.length > PIPELINE_MAX_NODES) {
    return fail("tooManyNodes");
  }

  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (typeof node.id !== "string" || node.id.length === 0) {
      return fail("emptyNodeId");
    }
    if (nodeIds.has(node.id)) {
      return fail("duplicateNodeId", { nodeId: node.id });
    }
    nodeIds.add(node.id);
  }

  for (const node of nodes) {
    if (!Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)) {
      return fail("badPosition", { nodeId: node.id });
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (typeof edge.id !== "string" || edge.id.length === 0) {
      return fail("emptyEdgeId");
    }
    if (edgeIds.has(edge.id)) {
      return fail("duplicateEdgeId", { edgeId: edge.id });
    }
    edgeIds.add(edge.id);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      return fail("unknownEndpoint", { edgeId: edge.id });
    }
    if (edge.from === edge.to) {
      return fail("selfEdge", { edgeId: edge.id });
    }
  }

  const sources = nodes.filter((node) => node.kind === "source");
  if (sources.length === 0) {
    return fail("noSource");
  }
  if (sources.length > 1) {
    const extra = sources[1];
    return fail("multipleSources", extra === undefined ? {} : { nodeId: extra.id });
  }
  const source = sources[0];
  if (source === undefined) {
    return fail("noSource");
  }

  const outputs = nodes.filter((node) => node.kind === "output");
  if (outputs.length === 0) {
    return fail("noOutput");
  }
  if (outputs.length > PIPELINE_MAX_OUTPUTS) {
    const extra = outputs[PIPELINE_MAX_OUTPUTS];
    return fail("tooManyOutputs", extra === undefined ? {} : { nodeId: extra.id });
  }

  const adjacency = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
    incoming.set(node.id, 0);
  }
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }

  const cycle = hasCycle(nodes, adjacency);
  if (cycle !== null) {
    return fail("cycle", { nodeId: cycle });
  }

  for (const node of nodes) {
    const count = incoming.get(node.id) ?? 0;
    if (node.kind === "source" && count > 0) {
      return fail("merge", { nodeId: node.id });
    }
    if (node.kind !== "source" && count > 1) {
      return fail("merge", { nodeId: node.id });
    }
  }

  const reached = new Set<string>([source.id]);
  const queue = [source.id];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    for (const target of adjacency.get(current) ?? []) {
      if (!reached.has(target)) {
        reached.add(target);
        queue.push(target);
      }
    }
  }
  for (const node of nodes) {
    if (!reached.has(node.id)) {
      return fail("disconnected", { nodeId: node.id });
    }
  }

  return { ok: true };
}
