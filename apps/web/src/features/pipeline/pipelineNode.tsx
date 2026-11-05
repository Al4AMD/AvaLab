/**
 * One React Flow node card for every F15 pipeline kind. Coordinates and
 * handles stay LTR; only labels and parameters follow the locale. This file
 * contains no DSP: the graph is executed in the worker.
 */
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { useTranslation } from "react-i18next";

import type { PipelineNode } from "./pipelineState";

export type PipelineFlowNodeData = {
  readonly pipelineNode: PipelineNode;
};

export type PipelineFlowNode = Node<PipelineFlowNodeData, "pipeline">;

export function PipelineNodeCard({ data, selected }: NodeProps<PipelineFlowNode>) {
  const { t } = useTranslation();
  const pipelineNode = data.pipelineNode;
  const hasInput = pipelineNode.kind !== "source";
  const hasOutput = pipelineNode.kind !== "output";
  const title =
    pipelineNode.kind === "output"
      ? pipelineNode.params.label
      : t(`pipeline.nodeKind.${pipelineNode.kind}`);

  return (
    <div
      data-testid={`pipeline.node.${pipelineNode.id}`}
      className={
        "min-w-36 rounded-md border bg-bg px-3 py-2 text-sm shadow-sm " +
        (selected ? "border-accent ring-2 ring-accent/40" : "border-surface")
      }
    >
      {hasInput ? <Handle type="target" position={Position.Left} className="!bg-accent" /> : null}
      <div className="font-medium text-text">{title}</div>
      <div dir="ltr" className="mt-0.5 text-xs text-muted">
        {pipelineNode.id}
      </div>
      {pipelineNode.kind === "codec" ? (
        <div dir="ltr" className="text-xs text-muted">
          {pipelineNode.params.codec}
        </div>
      ) : null}
      {hasOutput ? <Handle type="source" position={Position.Right} className="!bg-accent" /> : null}
    </div>
  );
}

export const pipelineNodeTypes = { pipeline: PipelineNodeCard };
