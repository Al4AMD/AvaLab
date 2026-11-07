import { describe, expect, it } from "vitest";
import type {
  PipelineEdge,
  PipelineErrorCode,
  PipelineGraph,
  PipelineNode,
  PipelineValidation,
} from "../../src/index.js";
import { validatePipeline } from "../../src/index.js";

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
  position: { x: 200, y: 0 },
};
const reverse: PipelineNode = {
  id: "reverse",
  kind: "reverse",
  params: {},
  position: { x: 100, y: 0 },
};

function edge(id: string, from: string, to: string): PipelineEdge {
  return { id, from, to };
}

function graph(nodes: readonly PipelineNode[], edges: readonly PipelineEdge[]): PipelineGraph {
  return { version: 1, nodes, edges };
}

function expectCode(result: PipelineValidation, code: PipelineErrorCode): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe(code);
  }
}

describe("validatePipeline", () => {
  it("accepts a linear graph", () => {
    expect(
      validatePipeline(
        graph(
          [source, reverse, output],
          [edge("e1", "source", "reverse"), edge("e2", "reverse", "output")],
        ),
      ),
    ).toEqual({ ok: true });
  });

  it("accepts a fan-out graph", () => {
    const outputB: PipelineNode = {
      id: "output-b",
      kind: "output",
      params: { label: "B" },
      position: { x: 200, y: 100 },
    };
    expect(
      validatePipeline(
        graph(
          [source, reverse, output, outputB],
          [
            edge("e1", "source", "reverse"),
            edge("e2", "reverse", "output"),
            edge("e3", "reverse", "output-b"),
          ],
        ),
      ),
    ).toEqual({ ok: true });
  });

  it("rejects a bad version", () => {
    expectCode(
      validatePipeline({ ...graph([], []), version: 2 } as unknown as PipelineGraph),
      "badVersion",
    );
  });

  it("rejects duplicate node ids", () => {
    expectCode(
      validatePipeline(
        graph([source, { ...reverse, id: "source" }, output], [edge("e1", "source", "output")]),
      ),
      "duplicateNodeId",
    );
  });

  it("rejects duplicate edge ids", () => {
    expectCode(
      validatePipeline(
        graph(
          [source, reverse, output],
          [edge("e", "source", "reverse"), edge("e", "reverse", "output")],
        ),
      ),
      "duplicateEdgeId",
    );
  });

  it("rejects an empty node id", () => {
    expectCode(validatePipeline(graph([{ ...source, id: "" }, output], [])), "emptyNodeId");
  });

  it("rejects an empty edge id", () => {
    expectCode(
      validatePipeline(graph([source, output], [edge("", "source", "output")])),
      "emptyEdgeId",
    );
  });

  it("rejects no source", () => {
    expectCode(validatePipeline(graph([output], [])), "noSource");
  });

  it("rejects multiple sources", () => {
    const secondSource: PipelineNode = { ...source, id: "source-2" };
    expectCode(validatePipeline(graph([source, secondSource, output], [])), "multipleSources");
  });

  it("rejects no output", () => {
    expectCode(
      validatePipeline(graph([source, reverse], [edge("e", "source", "reverse")])),
      "noOutput",
    );
  });

  it("rejects a cycle", () => {
    const a: PipelineNode = { ...reverse, id: "a" };
    const b: PipelineNode = { ...reverse, id: "b" };
    expectCode(
      validatePipeline(
        graph(
          [source, a, b, output],
          [
            edge("e1", "source", "a"),
            edge("e2", "a", "b"),
            edge("e3", "b", "a"),
            edge("e4", "source", "output"),
          ],
        ),
      ),
      "cycle",
    );
  });

  it("rejects a merge", () => {
    const a: PipelineNode = { ...reverse, id: "a" };
    const b: PipelineNode = { ...reverse, id: "b" };
    expectCode(
      validatePipeline(
        graph(
          [source, a, b, output],
          [
            edge("e1", "source", "a"),
            edge("e2", "source", "b"),
            edge("e3", "a", "output"),
            edge("e4", "b", "output"),
          ],
        ),
      ),
      "merge",
    );
  });

  it("rejects a disconnected node", () => {
    const detached: PipelineNode = { ...output, id: "detached" };
    expectCode(
      validatePipeline(graph([source, output, detached], [edge("e", "source", "output")])),
      "disconnected",
    );
  });

  it("rejects too many nodes", () => {
    const nodes: PipelineNode[] = [source];
    const edges: PipelineEdge[] = [];
    for (let index = 0; index < 23; index += 1) {
      const id = `n${index}`;
      nodes.push({ ...reverse, id, position: { x: index, y: 0 } });
      edges.push(edge(`e${index}`, index === 0 ? "source" : `n${index - 1}`, id));
    }
    nodes.push({ ...output, id: "last", position: { x: 23, y: 0 } });
    edges.push(edge("e-last", "n22", "last"));
    expectCode(validatePipeline(graph(nodes, edges)), "tooManyNodes");
  });

  it("rejects too many outputs", () => {
    const outputs: PipelineNode[] = [
      output,
      { ...output, id: "output-b" },
      { ...output, id: "output-c" },
    ];
    expectCode(
      validatePipeline(
        graph(
          [source, ...outputs],
          [
            edge("e1", "source", "output"),
            edge("e2", "source", "output-b"),
            edge("e3", "source", "output-c"),
          ],
        ),
      ),
      "tooManyOutputs",
    );
  });

  it("rejects a non-finite position", () => {
    expectCode(
      validatePipeline(
        graph(
          [{ ...source, position: { x: Number.NaN, y: 0 } }, output],
          [edge("e", "source", "output")],
        ),
      ),
      "badPosition",
    );
  });

  it("rejects an unknown endpoint", () => {
    expectCode(
      validatePipeline(graph([source, output], [edge("e", "missing", "output")])),
      "unknownEndpoint",
    );
  });

  it("rejects a self edge", () => {
    expectCode(
      validatePipeline(
        graph([source, output], [edge("e", "source", "source"), edge("e2", "source", "output")]),
      ),
      "selfEdge",
    );
  });
});
