import type { NodeProps } from "@xyflow/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { PipelineFlowNode } from "./pipelineNode";
import { addPipelineNode, defaultPipelineState, type PipelineNode } from "./pipelineState";

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  MiniMap: () => null,
  Position: { Left: "left", Right: "right" },
  ReactFlow: () => null,
}));

type Modules = {
  readonly PipelinePalette: typeof import("./pipelineView").PipelinePalette;
  readonly PipelineToolbar: typeof import("./pipelineView").PipelineToolbar;
  readonly PipelineNodeCard: typeof import("./pipelineNode").PipelineNodeCard;
  readonly t: typeof import("../../i18n").default.t;
};

let modules: Modules;

beforeAll(async () => {
  vi.stubGlobal("document", { documentElement: { lang: "", dir: "" }, title: "" });
  const [view, node, i18n] = await Promise.all([
    import("./pipelineView"),
    import("./pipelineNode"),
    import("../../i18n"),
  ]);
  modules = {
    ...view,
    PipelineNodeCard: node.PipelineNodeCard,
    t: i18n.default.t.bind(i18n.default),
  };
});

function buttonMarkup(markup: string, testId: string): string {
  const part = markup
    .split("<button")
    .find((candidate) => candidate.includes(`data-testid="${testId}"`));
  return part ?? "";
}

function isDisabled(markup: string, testId: string): boolean {
  return /\sdisabled(?:=""|>|\s)/.test(buttonMarkup(markup, testId));
}

function nodeProps(node: PipelineNode): NodeProps<PipelineFlowNode> {
  return {
    id: node.id,
    data: { pipelineNode: node },
    type: "pipeline",
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: true,
    selected: false,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: node.position.x,
    positionAbsoluteY: node.position.y,
  };
}

describe("pipeline palette", () => {
  it("disables the source after one exists and the output after two", () => {
    const graph = addPipelineNode(defaultPipelineState().graph, "output");
    const markup = renderToStaticMarkup(<modules.PipelinePalette graph={graph} onAdd={() => {}} />);

    expect(markup).toContain('data-testid="pipeline.palette"');
    expect(isDisabled(markup, "pipeline.palette.source")).toBe(true);
    expect(isDisabled(markup, "pipeline.palette.output")).toBe(true);
    expect(isDisabled(markup, "pipeline.palette.filter")).toBe(false);
  });
});

describe("pipeline toolbar", () => {
  it("disables run while the graph is invalid and cancel while idle", () => {
    const markup = renderToStaticMarkup(
      <modules.PipelineToolbar
        canRun={false}
        running={false}
        onRun={() => {}}
        onCancel={() => {}}
        onSave={() => {}}
        onLoad={() => {}}
      />,
    );

    expect(isDisabled(markup, "pipeline.run")).toBe(true);
    expect(isDisabled(markup, "pipeline.cancel")).toBe(true);
  });

  it("enables run and cancel during a valid running pipeline", () => {
    const markup = renderToStaticMarkup(
      <modules.PipelineToolbar
        canRun
        running
        onRun={() => {}}
        onCancel={() => {}}
        onSave={() => {}}
        onLoad={() => {}}
      />,
    );

    expect(isDisabled(markup, "pipeline.run")).toBe(false);
    expect(isDisabled(markup, "pipeline.cancel")).toBe(false);
  });
});

describe("pipeline node cards", () => {
  it("renders the source node with its localized kind", () => {
    const source = defaultPipelineState().graph.nodes.find((node) => node.kind === "source");
    expect(source).toBeDefined();
    if (source === undefined) {
      return;
    }
    const markup = renderToStaticMarkup(<modules.PipelineNodeCard {...nodeProps(source)} />);

    expect(markup).toContain('data-testid="pipeline.node.source-1"');
    expect(markup).toContain(modules.t("pipeline.nodeKind.source"));
    expect(markup).toContain("source-1");
  });

  it("renders the output node with its editable label", () => {
    const output = defaultPipelineState().graph.nodes.find((node) => node.kind === "output");
    expect(output).toBeDefined();
    if (output?.kind !== "output") {
      return;
    }
    const markup = renderToStaticMarkup(<modules.PipelineNodeCard {...nodeProps(output)} />);

    expect(markup).toContain('data-testid="pipeline.node.output-1"');
    expect(markup).toContain(output.params.label);
  });
});
