/**
 * F15 branching pipeline builder view. React Flow edits coordinates only;
 * every audio operation is dispatched through `usePipelineRun` into the DSP
 * worker. The canvas is deliberately LTR even in Persian so branch direction
 * never mirrors.
 */
import {
  Background,
  type Connection,
  Controls,
  type Edge,
  MiniMap,
  type NodeChange,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { ToolHeader } from "../../components/ToolHeader";

import { Button } from "../../components/ui/button";
import { formatHz, formatS } from "../../lib/format";
import { writeLastUsed } from "../../lib/lastUsed";
import type { PipelineOutput, PipelineStageSummary } from "../../session/ops";
import { useSessionStore } from "../../session/store";
import { ChannelPicker } from "../channels/ChannelPicker";
import { useChannelMode } from "../channels/useChannelMode";
import { UploadEmptyState } from "../input/upload";
import { TheoryPanel } from "../theory/TheoryPanel";
import { TOOL_THEORY } from "../theory/theoryContent";
import { type PipelineFlowNode, pipelineNodeTypes } from "./pipelineNode";
import {
  addPipelineNode,
  connectPipelineNodes,
  deletePipelineEdge,
  deletePipelineNode,
  encodePipelineState,
  loadPipelineState,
  PIPELINE_MAX_NODES,
  PIPELINE_MAX_OUTPUTS,
  PIPELINE_STORAGE_KEY,
  type PipelineEdge,
  type PipelineGraph,
  type PipelineNode,
  type PipelineNodeKind,
  type PipelineState,
  pipelineGraphFromJson,
  pipelineGraphToJson,
  pipelineNodeParamsError,
  pipelineParamsError,
  pipelineRunRange,
  pipelineStateFromSearch,
  replacePipelineNode,
  updatePipelinePosition,
  withPipelineValidation,
} from "./pipelineState";
import { type PipelineRunResult, usePipelineRun } from "./usePipelineRun";

const CONTROL_FOCUS_CLASSES =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const INPUT_CLASSES = `rounded border border-surface bg-bg px-2 py-1 text-sm ${CONTROL_FOCUS_CLASSES}`;
const ENVELOPE_WIDTH_PX = 220;
const ENVELOPE_HEIGHT_PX = 40;

type NodeParamsChange = (node: PipelineNode) => void;

function NumberInput({
  label,
  value,
  min,
  max,
  step,
  testId,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly testId: string;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted">{label}</span>
      <input
        type="number"
        dir="ltr"
        value={value}
        min={min}
        max={max}
        step={step}
        data-testid={testId}
        className={INPUT_CLASSES}
        onChange={(event) => {
          const next = Number(event.target.value);
          onChange(Number.isFinite(next) ? next : 0);
        }}
      />
    </label>
  );
}

function CheckboxInput({
  label,
  checked,
  testId,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly testId: string;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        data-testid={testId}
        className={CONTROL_FOCUS_CLASSES}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function CoefficientField({
  label,
  values,
  testId,
  onChange,
}: {
  readonly label: string;
  readonly values: readonly number[];
  readonly testId: string;
  readonly onChange: (values: number[]) => void;
}) {
  const [text, setText] = useState(() => values.join(", "));
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted">{label}</span>
      <input
        type="text"
        dir="ltr"
        value={text}
        data-testid={testId}
        className={INPUT_CLASSES}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const tokens = next
            .split(",")
            .map((token) => token.trim())
            .filter((token) => token.length > 0);
          if (tokens.length === 0) {
            onChange([]);
            return;
          }
          const numbers = tokens.map(Number);
          onChange(numbers.every((number) => Number.isFinite(number)) ? numbers : []);
        }}
      />
    </label>
  );
}

export function PipelinePropertiesPanel({
  node,
  edge,
  error,
  onChange,
  onDeleteNode,
  onDeleteEdge,
}: {
  readonly node: PipelineNode | null;
  readonly edge: PipelineEdge | null;
  readonly error: "badParams" | null;
  readonly onChange: NodeParamsChange;
  readonly onDeleteNode: (nodeId: string) => void;
  readonly onDeleteEdge: (edgeId: string) => void;
}) {
  const { t } = useTranslation();

  if (node === null) {
    if (edge === null) {
      return (
        <aside className="rounded border border-surface p-3 text-sm text-muted">
          {t("pipeline.properties.empty")}
        </aside>
      );
    }
    return (
      <aside className="flex flex-col gap-3 rounded border border-surface p-3 text-sm">
        <h2 className="font-semibold">{t("pipeline.properties.edge")}</h2>
        <p dir="ltr" className="text-xs text-muted">
          {edge.from} → {edge.to}
        </p>
        <Button
          variant="outline"
          size="sm"
          data-testid="pipeline.deleteEdge"
          onClick={() => onDeleteEdge(edge.id)}
        >
          {t("pipeline.action.deleteEdge")}
        </Button>
      </aside>
    );
  }

  const update = (next: PipelineNode): void => onChange(next);

  return (
    <aside className="flex flex-col gap-3 rounded border border-surface p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t(`pipeline.nodeKind.${node.kind}`)}</h2>
        <span dir="ltr" className="text-xs text-muted">
          {node.id}
        </span>
      </div>
      {error === null ? null : (
        <p role="alert" data-testid="pipeline.property.error" className="text-xs text-red-400">
          {t("pipeline.property.invalid")}
        </p>
      )}
      {node.kind === "source" ? (
        <p className="text-xs text-muted">{t("pipeline.properties.source")}</p>
      ) : null}
      {node.kind === "reverse" ? (
        <p className="text-xs text-muted">{t("pipeline.properties.reverse")}</p>
      ) : null}
      {node.kind === "output" ? (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted">{t("pipeline.property.label")}</span>
          <input
            type="text"
            value={node.params.label}
            data-testid="pipeline.property.label"
            className={INPUT_CLASSES}
            onChange={(event) =>
              update({ ...node, params: { label: event.target.value.slice(0, 200) } })
            }
          />
        </label>
      ) : null}
      {node.kind === "resample" ? (
        <>
          <NumberInput
            label={t("pipeline.property.targetRate")}
            value={node.params.targetRateHz}
            min={1}
            max={96_000}
            step={1}
            testId="pipeline.property.targetRate"
            onChange={(targetRateHz) =>
              update({ ...node, params: { ...node.params, targetRateHz } })
            }
          />
          <CheckboxInput
            label={t("pipeline.property.antiAlias")}
            checked={node.params.antiAlias}
            testId="pipeline.property.antiAlias"
            onChange={(antiAlias) => update({ ...node, params: { ...node.params, antiAlias } })}
          />
        </>
      ) : null}
      {node.kind === "filter" ? (
        <>
          <CoefficientField
            label={t("pipeline.property.filterB")}
            values={node.params.b}
            testId="pipeline.property.filterB"
            onChange={(b) => update({ ...node, params: { ...node.params, b } })}
          />
          <CoefficientField
            label={t("pipeline.property.filterA")}
            values={node.params.a}
            testId="pipeline.property.filterA"
            onChange={(a) => update({ ...node, params: { ...node.params, a } })}
          />
          <CheckboxInput
            label={t("pipeline.property.fir")}
            checked={node.params.fir}
            testId="pipeline.property.fir"
            onChange={(fir) => update({ ...node, params: { ...node.params, fir } })}
          />
          <CheckboxInput
            label={t("pipeline.property.compensateDelay")}
            checked={node.params.compensateDelay}
            testId="pipeline.property.compensateDelay"
            onChange={(compensateDelay) =>
              update({ ...node, params: { ...node.params, compensateDelay } })
            }
          />
        </>
      ) : null}
      {node.kind === "quantize" ? (
        <>
          <NumberInput
            label={t("pipeline.property.bits")}
            value={node.params.bits}
            min={1}
            max={24}
            step={1}
            testId="pipeline.property.bits"
            onChange={(bits) => update({ ...node, params: { ...node.params, bits } })}
          />
          <CheckboxInput
            label={t("pipeline.property.dither")}
            checked={node.params.dither}
            testId="pipeline.property.dither"
            onChange={(dither) => update({ ...node, params: { ...node.params, dither } })}
          />
          <NumberInput
            label={t("pipeline.property.seed")}
            value={node.params.seed}
            min={0}
            step={1}
            testId="pipeline.property.seed"
            onChange={(seed) => update({ ...node, params: { ...node.params, seed } })}
          />
        </>
      ) : null}
      {node.kind === "codec" ? (
        <>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">{t("pipeline.property.codec")}</span>
            <select
              value={node.params.codec}
              data-testid="pipeline.property.codec"
              className={INPUT_CLASSES}
              onChange={(event) =>
                update({
                  ...node,
                  params: {
                    ...node.params,
                    codec: event.target.value as typeof node.params.codec,
                  },
                })
              }
            >
              {(["rle", "huffman", "deltaHuffman", "mulaw", "alaw", "mdct"] as const).map(
                (codec) => (
                  <option key={codec} value={codec}>
                    {t(`pipeline.codec.${codec}`)}
                  </option>
                ),
              )}
            </select>
          </label>
          {node.params.codec === "mdct" ? (
            <>
              <NumberInput
                label={t("pipeline.property.mdctKbps")}
                value={node.params.mdctBitsPerSecond / 1000}
                min={8}
                max={512}
                step={1}
                testId="pipeline.property.mdctKbps"
                onChange={(kbps) =>
                  update({
                    ...node,
                    params: { ...node.params, mdctBitsPerSecond: kbps * 1000 },
                  })
                }
              />
              <CheckboxInput
                label={t("pipeline.property.psychoacoustic")}
                checked={node.params.psychoacoustic}
                testId="pipeline.property.psychoacoustic"
                onChange={(psychoacoustic) =>
                  update({ ...node, params: { ...node.params, psychoacoustic } })
                }
              />
              <NumberInput
                label={t("pipeline.property.referenceSpl")}
                value={node.params.referenceSplDb}
                min={80}
                max={100}
                step={1}
                testId="pipeline.property.referenceSpl"
                onChange={(referenceSplDb) =>
                  update({ ...node, params: { ...node.params, referenceSplDb } })
                }
              />
            </>
          ) : null}
        </>
      ) : null}
      {node.kind === "reverb" ? (
        <>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">{t("pipeline.property.irKind")}</span>
            <select
              value={node.params.ir.kind}
              data-testid="pipeline.property.irKind"
              className={INPUT_CLASSES}
              onChange={(event) =>
                update({
                  ...node,
                  params: {
                    ...node.params,
                    ir: {
                      ...node.params.ir,
                      kind: event.target.value as typeof node.params.ir.kind,
                    },
                  },
                })
              }
            >
              {(["room", "hall", "plate", "telephone"] as const).map((kind) => (
                <option key={kind} value={kind}>
                  {t(`pipeline.ir.${kind}`)}
                </option>
              ))}
            </select>
          </label>
          <NumberInput
            label={t("pipeline.property.irDuration")}
            value={node.params.ir.durationSeconds}
            min={0.05}
            max={10}
            step={0.05}
            testId="pipeline.property.irDuration"
            onChange={(durationSeconds) =>
              update({
                ...node,
                params: {
                  ...node.params,
                  ir: { ...node.params.ir, durationSeconds },
                },
              })
            }
          />
          <NumberInput
            label={t("pipeline.property.rt60")}
            value={node.params.ir.rt60Seconds}
            min={0.05}
            max={10}
            step={0.05}
            testId="pipeline.property.rt60"
            onChange={(rt60Seconds) =>
              update({
                ...node,
                params: {
                  ...node.params,
                  ir: { ...node.params.ir, rt60Seconds },
                },
              })
            }
          />
          <NumberInput
            label={t("pipeline.property.preDelay")}
            value={node.params.preDelayMs}
            min={0}
            step={1}
            testId="pipeline.property.preDelay"
            onChange={(preDelayMs) => update({ ...node, params: { ...node.params, preDelayMs } })}
          />
          <NumberInput
            label={t("pipeline.property.wetMix")}
            value={node.params.wetMix}
            min={0}
            max={1}
            step={0.05}
            testId="pipeline.property.wetMix"
            onChange={(wetMix) => update({ ...node, params: { ...node.params, wetMix } })}
          />
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted">{t("pipeline.property.method")}</span>
            <select
              value={node.params.method}
              data-testid="pipeline.property.method"
              className={INPUT_CLASSES}
              onChange={(event) =>
                update({
                  ...node,
                  params: {
                    ...node.params,
                    method: event.target.value === "direct" ? "direct" : "fft",
                  },
                })
              }
            >
              <option value="fft">FFT</option>
              <option value="direct">{t("pipeline.method.direct")}</option>
            </select>
          </label>
          <NumberInput
            label={t("pipeline.property.seed")}
            value={node.params.ir.seed}
            min={0}
            step={1}
            testId="pipeline.property.irSeed"
            onChange={(seed) =>
              update({
                ...node,
                params: { ...node.params, ir: { ...node.params.ir, seed } },
              })
            }
          />
        </>
      ) : null}
      {node.kind === "timeStretch" ? (
        <>
          <NumberInput
            label={t("pipeline.property.speed")}
            value={node.params.speedFactor}
            min={0.25}
            max={4}
            step={0.05}
            testId="pipeline.property.speed"
            onChange={(speedFactor) => update({ ...node, params: { ...node.params, speedFactor } })}
          />
          <NumberInput
            label={t("pipeline.property.pitch")}
            value={node.params.pitchSemitones}
            min={-12}
            max={12}
            step={1}
            testId="pipeline.property.pitch"
            onChange={(pitchSemitones) =>
              update({ ...node, params: { ...node.params, pitchSemitones } })
            }
          />
        </>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        data-testid="pipeline.deleteNode"
        onClick={() => onDeleteNode(node.id)}
      >
        {t("pipeline.action.deleteNode")}
      </Button>
    </aside>
  );
}

export function PipelinePalette({
  graph,
  onAdd,
}: {
  readonly graph: PipelineGraph;
  readonly onAdd: (kind: PipelineNodeKind) => void;
}) {
  const { t } = useTranslation();
  const outputs = graph.nodes.filter((node) => node.kind === "output").length;
  const full = graph.nodes.length >= PIPELINE_MAX_NODES;
  return (
    <section className="flex flex-wrap items-center gap-2" data-testid="pipeline.palette">
      <span className="me-1 text-xs text-muted">{t("pipeline.palette.title")}</span>
      {(
        [
          "source",
          "resample",
          "filter",
          "quantize",
          "codec",
          "reverb",
          "reverse",
          "timeStretch",
          "output",
        ] as const
      ).map((kind) => (
        <Button
          key={kind}
          variant="outline"
          size="sm"
          data-testid={`pipeline.palette.${kind}`}
          disabled={
            full ||
            (kind === "source" && graph.nodes.some((node) => node.kind === "source")) ||
            (kind === "output" && outputs >= PIPELINE_MAX_OUTPUTS)
          }
          onClick={() => onAdd(kind)}
        >
          {t(`pipeline.nodeKind.${kind}`)}
        </Button>
      ))}
    </section>
  );
}

export function PipelineToolbar({
  canRun,
  running,
  onRun,
  onCancel,
  onSave,
  onLoad,
}: {
  readonly canRun: boolean;
  readonly running: boolean;
  readonly onRun: () => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly onLoad: (file: File) => void;
}) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button data-testid="pipeline.run" disabled={!canRun} onClick={onRun}>
        {t("pipeline.action.run")}
      </Button>
      <Button
        variant="outline"
        data-testid="pipeline.cancel"
        disabled={!running}
        onClick={onCancel}
      >
        {t("pipeline.action.cancel")}
      </Button>
      <Button variant="outline" data-testid="pipeline.save" onClick={onSave}>
        {t("pipeline.action.save")}
      </Button>
      <Button
        variant="outline"
        data-testid="pipeline.load"
        onClick={() => fileRef.current?.click()}
      >
        {t("pipeline.action.load")}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        data-testid="pipeline.loadFile"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) {
            onLoad(file);
          }
        }}
      />
    </div>
  );
}

function StageEnvelope({
  envelope,
  testId,
}: {
  readonly envelope: Float32Array;
  readonly testId: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    canvas.width = Math.round(ENVELOPE_WIDTH_PX * dpr);
    canvas.height = Math.round(ENVELOPE_HEIGHT_PX * dpr);
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const buckets = Math.floor(envelope.length / 2);
    if (buckets === 0) {
      return;
    }
    ctx.strokeStyle = "#8bd3c7";
    ctx.beginPath();
    for (let bucket = 0; bucket < buckets; bucket += 1) {
      const min = envelope[bucket * 2] ?? 0;
      const max = envelope[bucket * 2 + 1] ?? 0;
      const x = (bucket / Math.max(1, buckets - 1)) * ENVELOPE_WIDTH_PX;
      const top = ((1 - Math.max(min, max)) / 2) * ENVELOPE_HEIGHT_PX;
      const bottom = ((1 - Math.min(min, max)) / 2) * ENVELOPE_HEIGHT_PX;
      ctx.moveTo(x * dpr, top * dpr);
      ctx.lineTo(x * dpr, bottom * dpr);
    }
    ctx.stroke();
  }, [envelope]);
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={testId}
      data-testid={testId}
      style={{ width: `${ENVELOPE_WIDTH_PX}px`, height: `${ENVELOPE_HEIGHT_PX}px` }}
      className="rounded bg-bg ring-1 ring-surface"
    />
  );
}

export function PipelineStageCards({
  stages,
}: {
  readonly stages: readonly PipelineStageSummary[];
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="pipeline.stages">
      {stages.map((stage) => (
        <article
          key={stage.nodeId}
          data-testid={`pipeline.stage.${stage.nodeId}`}
          className="flex flex-col gap-1 rounded border border-surface p-2 text-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{t(`pipeline.nodeKind.${stage.kind}`)}</span>
            <span dir="ltr" className="text-muted">
              {stage.nodeId}
            </span>
          </div>
          <StageEnvelope
            envelope={stage.envelope}
            testId={`pipeline.stage.${stage.nodeId}.envelope`}
          />
          <dl dir="ltr" className="grid grid-cols-2 gap-x-2 gap-y-0.5 tabular-nums text-muted">
            <dt>{t("pipeline.stage.duration")}</dt>
            <dd>{formatS(stage.durationSeconds)}</dd>
            <dt>{t("pipeline.stage.rate")}</dt>
            <dd>{formatHz(stage.sampleRateHz)}</dd>
            <dt>{t("pipeline.stage.peak")}</dt>
            <dd>{stage.peak.toFixed(3)}</dd>
            <dt>{t("pipeline.stage.rms")}</dt>
            <dd>{stage.rms.toFixed(3)}</dd>
            <dt>{t("pipeline.stage.elapsed")}</dt>
            <dd>{formatS(stage.elapsedMs / 1000)}</dd>
          </dl>
        </article>
      ))}
    </div>
  );
}

function OutputControls({
  outputs,
  selectedOutputId,
  onSelect,
  onInstall,
  installError,
}: {
  readonly outputs: readonly PipelineOutput[];
  readonly selectedOutputId: string | null;
  readonly onSelect: (outputId: string) => void;
  readonly onInstall: () => void;
  readonly installError: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted">{t("pipeline.output.select")}</span>
        <select
          value={selectedOutputId ?? ""}
          data-testid="pipeline.output.select"
          className={INPUT_CLASSES}
          onChange={(event) => onSelect(event.target.value)}
        >
          {outputs.map((output) => (
            <option key={output.nodeId} value={output.nodeId}>
              {output.label} · {formatHz(output.sampleRateHz)} ·{" "}
              {formatS(output.sampleCount / output.sampleRateHz)}
            </option>
          ))}
        </select>
      </label>
      <Button
        data-testid="pipeline.output.install"
        disabled={selectedOutputId === null}
        onClick={onInstall}
      >
        {t("pipeline.action.install")}
      </Button>
      {installError === null ? null : (
        <span role="alert" className="text-xs text-red-400">
          {t(`pipeline.error.${installError}`)}
        </span>
      )}
    </div>
  );
}

function LaneStats({ result }: { readonly result: PipelineRunResult }): React.ReactElement | null {
  const { t } = useTranslation();
  if (result.laneSamples.length < 2 || result.outputs.length === 0) {
    return null;
  }
  const labels = [t("pipeline.lane.left"), t("pipeline.lane.right")];
  return (
    <table data-testid="pipeline.result.lanes" dir="ltr" className="w-full text-xs">
      <thead>
        <tr className="text-muted">
          <th className="text-start font-medium">{t("pipeline.lane.title")}</th>
          <th className="text-start font-medium">{t("pipeline.output.select")}</th>
          <th className="text-start font-medium">{t("pipeline.stage.rate")}</th>
          <th className="text-start font-medium">{t("pipeline.stage.duration")}</th>
          <th className="text-start font-medium">{t("pipeline.stage.peak")}</th>
          <th className="text-start font-medium">{t("pipeline.stage.rms")}</th>
        </tr>
      </thead>
      <tbody>
        {result.outputs.flatMap((output) =>
          result.laneStages.map((stages, lane) => {
            const stage = stages.find((candidate) => candidate.nodeId === output.nodeId);
            return (
              <tr key={`${output.nodeId}-${String(lane)}`}>
                <td>{labels[lane] ?? String(lane)}</td>
                <td>{output.label}</td>
                <td>{formatHz(stage?.sampleRateHz ?? output.sampleRateHz)}</td>
                <td>{formatS(stage?.durationSeconds ?? 0)}</td>
                <td>{stage === undefined ? "-" : stage.peak.toFixed(4)}</td>
                <td>{stage === undefined ? "-" : stage.rms.toFixed(4)}</td>
              </tr>
            );
          }),
        )}
      </tbody>
    </table>
  );
}

export function PipelineView(): React.ReactElement {
  const { t } = useTranslation();
  const original = useSessionStore((session) => session.original);
  const selection = useSessionStore((session) => session.selection);
  const [searchParams, setSearchParams] = useSearchParams();
  const [initial] = useState(() =>
    searchParams.toString() === ""
      ? loadPipelineState()
      : pipelineStateFromSearch(`?${searchParams.toString()}`),
  );
  const [state, setState] = useState<PipelineState>(initial.state);
  const [urlWarning, setUrlWarning] = useState(initial.warning);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [installed, setInstalled] = useState<string | null>(null);
  const lastEncodedRef = useRef<string | null>(null);
  const range = useMemo(
    () => pipelineRunRange(selection, original?.samples.length ?? 0, original?.sampleRateHz ?? 1),
    [original, selection],
  );
  const channel = useChannelMode(original, "both");
  const run = usePipelineRun(state, range, channel.mode);
  const paramsError = pipelineParamsError(state.graph);
  const canRun =
    original !== null &&
    state.validation.ok &&
    paramsError === null &&
    range.endSample > range.startSample &&
    run.status !== "running";

  useEffect(() => {
    const encoded = encodePipelineState(state);
    if (encoded.warning !== null) {
      setUrlWarning(encoded.warning);
      return;
    }
    writeLastUsed(PIPELINE_STORAGE_KEY, encoded.search);
    if (encoded.search === lastEncodedRef.current) {
      return;
    }
    lastEncodedRef.current = encoded.search;
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of new URLSearchParams(encoded.search)) {
      next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, state]);

  const flowNodes = useMemo<PipelineFlowNode[]>(
    () =>
      state.graph.nodes.map((node) => ({
        id: node.id,
        type: "pipeline",
        position: node.position,
        data: { pipelineNode: node },
        selected: node.id === state.selectedNodeId,
      })),
    [state.graph.nodes, state.selectedNodeId],
  );
  const flowEdges = useMemo<Edge[]>(
    () =>
      state.graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        selected: edge.id === state.selectedEdgeId,
      })),
    [state.graph.edges, state.selectedEdgeId],
  );

  function commitGraph(next: PipelineGraph, selectNodeId?: string): void {
    setState((current) => {
      const selectedNodeId =
        selectNodeId ??
        (current.selectedNodeId !== null &&
        next.nodes.some((node) => node.id === current.selectedNodeId)
          ? current.selectedNodeId
          : (next.nodes.find((node) => node.kind === "source")?.id ?? null));
      const selectedEdgeId =
        current.selectedEdgeId !== null &&
        next.edges.some((edge) => edge.id === current.selectedEdgeId)
          ? current.selectedEdgeId
          : null;
      const selectedOutputId =
        current.selectedOutputId !== null &&
        next.nodes.some((node) => node.id === current.selectedOutputId && node.kind === "output")
          ? current.selectedOutputId
          : (next.nodes.find((node) => node.kind === "output")?.id ?? null);
      return withPipelineValidation({
        graph: next,
        selectedNodeId,
        selectedEdgeId,
        selectedOutputId,
      });
    });
  }

  function handleAdd(kind: PipelineNodeKind): void {
    const before = new Set(state.graph.nodes.map((node) => node.id));
    const next = addPipelineNode(state.graph, kind);
    const added = next.nodes.find((node) => !before.has(node.id));
    setActionError(null);
    commitGraph(next, added?.id);
  }

  function handleConnect(connection: Connection): void {
    if (connection.source === null || connection.target === null) {
      return;
    }
    const next = connectPipelineNodes(state.graph, connection.source, connection.target);
    if (next === state.graph) {
      setActionError("invalidConnection");
      return;
    }
    setActionError(null);
    commitGraph(next);
  }

  function handleNodesChange(changes: NodeChange<PipelineFlowNode>[]): void {
    let nextGraph = state.graph;
    for (const change of changes) {
      if (change.type === "position" && change.position !== undefined) {
        nextGraph = updatePipelinePosition(nextGraph, change.id, change.position);
      }
    }
    if (nextGraph !== state.graph) {
      commitGraph(nextGraph);
    }
  }

  function handleDeleteNode(nodeId: string): void {
    const next = deletePipelineNode(state.graph, nodeId);
    if (next === state.graph) {
      setActionError("cannotDeleteLast");
      return;
    }
    setActionError(null);
    commitGraph(next);
  }

  function handleDeleteEdge(edgeId: string): void {
    commitGraph(deletePipelineEdge(state.graph, edgeId));
  }

  function handleNodeParams(node: PipelineNode): void {
    setInstalled(null);
    commitGraph(replacePipelineNode(state.graph, node));
  }

  function saveGraph(): void {
    const blob = new Blob([pipelineGraphToJson(state.graph)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "avalab-pipeline.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function loadGraph(file: File): Promise<void> {
    const parsed = pipelineGraphFromJson(await file.text());
    if (!parsed.ok) {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    setActionError(null);
    setUrlWarning(null);
    const source = parsed.graph.nodes.find((node) => node.kind === "source");
    setState(
      withPipelineValidation({
        graph: parsed.graph,
        selectedNodeId: source?.id ?? null,
        selectedEdgeId: null,
        selectedOutputId: parsed.graph.nodes.find((node) => node.kind === "output")?.id ?? null,
      }),
    );
  }

  function installOutput(): void {
    if (state.selectedOutputId === null) {
      return;
    }
    const result = run.installOutput(state.selectedOutputId);
    setInstalled(result.ok ? state.selectedOutputId : null);
    if (!result.ok) {
      setActionError(result.reason);
    } else {
      setActionError(null);
    }
  }

  const selectedNode =
    state.selectedNodeId === null
      ? null
      : (state.graph.nodes.find((node) => node.id === state.selectedNodeId) ?? null);
  const selectedEdge =
    state.selectedEdgeId === null
      ? null
      : (state.graph.edges.find((edge) => edge.id === state.selectedEdgeId) ?? null);
  const selectedNodeError = selectedNode === null ? null : pipelineNodeParamsError(selectedNode);

  return (
    <div className="flex flex-col gap-4" data-testid="pipeline.view">
      <ToolHeader titleKey="tool.pipeline.title" descriptionKey="tool.pipeline.description" />
      {urlWarning === null ? null : (
        <p role="alert" data-testid="pipeline.warning" className="text-xs text-amber-400">
          {t(`pipeline.warning.${urlWarning}`)}
        </p>
      )}
      {loadError ? (
        <p role="alert" data-testid="pipeline.loadError" className="text-xs text-red-400">
          {t("pipeline.warning.invalid")}
        </p>
      ) : null}
      {original === null ? <UploadEmptyState /> : null}
      <PipelinePalette graph={state.graph} onAdd={handleAdd} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div
          dir="ltr"
          data-testid="pipeline.canvas"
          className="h-[460px] overflow-hidden rounded border border-surface bg-bg"
        >
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={pipelineNodeTypes}
            onNodesChange={handleNodesChange}
            onConnect={handleConnect}
            onNodeClick={(_event, node) => {
              setState((current) =>
                withPipelineValidation({
                  ...current,
                  selectedNodeId: node.id,
                  selectedEdgeId: null,
                }),
              );
            }}
            onEdgeClick={(_event, edge) => {
              setState((current) =>
                withPipelineValidation({
                  ...current,
                  selectedNodeId: null,
                  selectedEdgeId: edge.id,
                }),
              );
            }}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
        <PipelinePropertiesPanel
          node={selectedNode}
          edge={selectedEdge}
          error={selectedNodeError}
          onChange={handleNodeParams}
          onDeleteNode={handleDeleteNode}
          onDeleteEdge={handleDeleteEdge}
        />
      </div>
      <ChannelPicker mode={channel.mode} modes={channel.modes} onChange={channel.setMode} />
      <PipelineToolbar
        canRun={canRun}
        running={run.status === "running"}
        onRun={run.run}
        onCancel={run.cancel}
        onSave={saveGraph}
        onLoad={(file) => {
          void loadGraph(file);
        }}
      />
      {state.validation.ok ? null : (
        <p role="alert" data-testid="pipeline.validationError" className="text-xs text-red-400">
          {t(`pipeline.error.${state.validation.code}`)}
          {state.validation.nodeId === undefined ? "" : ` (${state.validation.nodeId})`}
          {state.validation.edgeId === undefined ? "" : ` (${state.validation.edgeId})`}
        </p>
      )}
      {paramsError === null ? null : (
        <p role="alert" data-testid="pipeline.paramsError" className="text-xs text-red-400">
          {t("pipeline.error.badParams")} ({paramsError.nodeId})
        </p>
      )}
      {actionError === null ? null : (
        <p role="alert" data-testid="pipeline.actionError" className="text-xs text-red-400">
          {t(`pipeline.error.${actionError}`)}
        </p>
      )}
      {run.status === "error" ? (
        <p role="alert" data-testid="pipeline.runError" className="text-xs text-red-400">
          {t(`pipeline.error.${run.errorCode ?? "failed"}`)}
        </p>
      ) : null}
      {run.result === null ? null : (
        <section className="flex flex-col gap-3" data-testid="pipeline.result">
          <h2 className="font-semibold">{t("pipeline.result.title")}</h2>
          <p dir="ltr" className="text-xs text-muted">
            {formatS(run.result.totalElapsedMs / 1000)}
          </p>
          <LaneStats result={run.result} />
          <PipelineStageCards stages={run.result.stages} />
          <OutputControls
            outputs={run.result.outputs}
            selectedOutputId={state.selectedOutputId}
            onSelect={(outputId) => {
              setInstalled(null);
              setState((current) =>
                withPipelineValidation({ ...current, selectedOutputId: outputId }),
              );
            }}
            onInstall={installOutput}
            installError={actionError}
          />
          {installed === null ? null : (
            <p className="text-xs text-muted" data-testid="pipeline.installed">
              {t("pipeline.output.installed")}
            </p>
          )}
        </section>
      )}
      <TheoryPanel
        titleKey={TOOL_THEORY.pipeline.titleKey}
        sections={TOOL_THEORY.pipeline.sections}
      />
    </div>
  );
}

export default PipelineView;
