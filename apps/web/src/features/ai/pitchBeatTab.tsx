/**
 * Pitch and beat tab (F14, Wave-6 Plan 04 Task 5).
 *
 * Both tasks are non-neural librosa analyses. They share one visible tab and
 * one 30 s excerpt path, but never touch the model registry or banner. Pitch
 * results draw an F0 curve; beat results list tempo and beat times.
 */
import type { BeatAnalysis, PitchAnalysis, PitchBeatAnalysis } from "@avalab/dsp";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/button";
import { useSessionStore } from "../../session/store";
import { UploadEmptyState } from "../input/upload";
import { AI_MAX_EXCERPT_SECONDS, type AiExcerptInput, readAnalysisResult } from "./aiClient";
import type { AnalysisTask } from "./aiState";
import { type AiJobStatus, useAiJob } from "./useAiJob";

export type PitchBeatViewProps = {
  readonly backendOnline: boolean;
  readonly task: AnalysisTask;
  readonly hasSource: boolean;
  readonly status: AiJobStatus;
  readonly progress: number;
  readonly errorKey: string | null;
  readonly analysis: PitchBeatAnalysis | null;
  readonly excerptSeconds: number;
  readonly onTaskChange: (task: AnalysisTask) => void;
  readonly onRun: () => void;
  readonly onCancel: () => void;
};

function numbers(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const result: number[] = [];
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      return null;
    }
    result.push(entry);
  }
  return result;
}

function nullableNumbers(value: unknown): (number | null)[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const result: (number | null)[] = [];
  for (const entry of value) {
    if (entry === null) {
      result.push(null);
    } else if (typeof entry === "number" && Number.isFinite(entry)) {
      result.push(entry);
    } else {
      return null;
    }
  }
  return result;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Parse the backend analysis envelope; reject mismatched or malformed arrays. */
export function readPitchBeatResult(
  result: Record<string, unknown> | null,
): PitchBeatAnalysis | null {
  const envelope = readAnalysisResult(result);
  if (envelope === null) {
    return null;
  }
  const kind = envelope.analysis.analysis_kind;
  if (kind === "pitch") {
    const timesSeconds = numbers(envelope.analysis.times_s);
    const f0Hz = nullableNumbers(envelope.analysis.f0_hz);
    const voicedProbability = numbers(envelope.analysis.voiced_probability);
    if (
      timesSeconds === null ||
      f0Hz === null ||
      voicedProbability === null ||
      timesSeconds.length !== f0Hz.length ||
      f0Hz.length !== voicedProbability.length
    ) {
      return null;
    }
    const voiced = f0Hz.filter((value): value is number => value !== null);
    const medianFromStats = finiteOrNull(envelope.stats.median_f0_hz);
    const fractionFromStats = finiteOrNull(envelope.stats.voiced_fraction);
    const analysis: PitchAnalysis = {
      analysisKind: "pitch",
      timesSeconds,
      f0Hz,
      voicedProbability,
      medianF0Hz:
        medianFromStats ??
        (voiced.length === 0
          ? null
          : (voiced.slice().sort((a, b) => a - b)[Math.floor(voiced.length / 2)] ?? null)),
      voicedFraction: fractionFromStats ?? (f0Hz.length === 0 ? 0 : voiced.length / f0Hz.length),
    };
    return analysis;
  }
  if (kind === "beat") {
    const tempoBpm = finiteOrNull(envelope.analysis.tempo_bpm);
    const beatTimesSeconds = numbers(envelope.analysis.beat_times_s);
    if (tempoBpm === null || beatTimesSeconds === null) {
      return null;
    }
    const analysis: BeatAnalysis = {
      analysisKind: "beat",
      tempoBpm,
      beatTimesSeconds,
    };
    return analysis;
  }
  return null;
}

export function pitchBeatRunDisabled(input: {
  readonly backendOnline: boolean;
  readonly hasSource: boolean;
  readonly busy: boolean;
}): boolean {
  return !input.backendOnline || !input.hasSource || input.busy;
}

function statusLine(
  t: ReturnType<typeof useTranslation>["t"],
  status: AiJobStatus,
  progress: number,
): string {
  switch (status) {
    case "uploading":
      return t("ai.job.uploading");
    case "running":
      return t("ai.job.running", { percent: Math.round(progress * 100) });
    case "done":
      return t("ai.job.done");
    case "cancelled":
      return t("ai.job.cancelled");
    case "error":
    case "idle":
      return "";
  }
}

function drawPitchCurve(canvas: HTMLCanvasElement, analysis: PitchAnalysis): void {
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    return;
  }
  const width = canvas.width;
  const height = canvas.height;
  const pad = 28;
  ctx.clearRect(0, 0, width, height);

  const voiced = analysis.f0Hz.filter((value): value is number => value !== null);
  const minHz = voiced.length === 0 ? 0 : Math.min(...voiced);
  const maxHz = voiced.length === 0 ? 1 : Math.max(...voiced);
  const span = Math.max(1, maxHz - minHz);
  const lastTime = analysis.timesSeconds.at(-1) ?? 1;

  ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
  ctx.lineWidth = 1;
  for (let step = 0; step <= 4; step += 1) {
    const y = pad + ((height - 2 * pad) * step) / 4;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  let drawing = false;
  analysis.f0Hz.forEach((value, index) => {
    if (value === null) {
      drawing = false;
      return;
    }
    const time = analysis.timesSeconds[index] ?? 0;
    const x = pad + ((width - 2 * pad) * time) / Math.max(lastTime, Number.EPSILON);
    const y = height - pad - ((height - 2 * pad) * (value - minHz)) / span;
    if (drawing) {
      ctx.lineTo(x, y);
    } else {
      ctx.moveTo(x, y);
      drawing = true;
    }
  });
  ctx.stroke();
}

function PitchCurve({ analysis }: { readonly analysis: PitchAnalysis }): React.ReactElement {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (canvasRef.current !== null) {
      drawPitchCurve(canvasRef.current, analysis);
    }
  }, [analysis]);
  return (
    <figure className="flex flex-col gap-1">
      <canvas
        ref={canvasRef}
        data-testid="ai.pitchBeat.pitchCanvas"
        role="img"
        aria-label={t("ai.pitchBeat.pitchChartAria")}
        dir="ltr"
        width={720}
        height={240}
        className="w-full rounded-md border border-surface bg-bg"
      />
      <figcaption className="text-xs text-muted">{t("ai.pitchBeat.pitchChartNote")}</figcaption>
    </figure>
  );
}

function Stats({
  analysis,
  t,
}: {
  readonly analysis: PitchBeatAnalysis;
  readonly t: ReturnType<typeof useTranslation>["t"];
}): React.ReactElement {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      {analysis.analysisKind === "pitch" ? (
        <>
          <dt className="text-muted">{t("ai.pitchBeat.medianF0")}</dt>
          <dd data-testid="ai.pitchBeat.medianF0" dir="ltr" className="tabular-nums">
            {analysis.medianF0Hz === null
              ? t("ai.pitchBeat.unvoiced")
              : t("ai.pitchBeat.hzValue", { hz: analysis.medianF0Hz.toFixed(2) })}
          </dd>
          <dt className="text-muted">{t("ai.pitchBeat.voicedFraction")}</dt>
          <dd data-testid="ai.pitchBeat.voicedFraction" dir="ltr" className="tabular-nums">
            {t("ai.pitchBeat.percentValue", {
              percent: (analysis.voicedFraction * 100).toFixed(1),
            })}
          </dd>
        </>
      ) : (
        <>
          <dt className="text-muted">{t("ai.pitchBeat.tempo")}</dt>
          <dd data-testid="ai.pitchBeat.tempo" dir="ltr" className="tabular-nums">
            {t("ai.pitchBeat.bpmValue", { bpm: analysis.tempoBpm.toFixed(2) })}
          </dd>
          <dt className="text-muted">{t("ai.pitchBeat.beatCount")}</dt>
          <dd data-testid="ai.pitchBeat.beatCount" dir="ltr" className="tabular-nums">
            {analysis.beatTimesSeconds.length}
          </dd>
        </>
      )}
    </dl>
  );
}

export function PitchBeatView(props: PitchBeatViewProps): React.ReactElement {
  const { t } = useTranslation();
  const busy = props.status === "uploading" || props.status === "running";
  const runDisabled = pitchBeatRunDisabled({ ...props, busy });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t("ai.pitchBeat.intro")}</p>

      <fieldset className="flex gap-2">
        <legend className="sr-only">{t("ai.pitchBeat.modeLabel")}</legend>
        {(["pitch", "beat"] as const).map((candidate) => (
          <Button
            key={candidate}
            variant={props.task === candidate ? "default" : "outline"}
            data-testid={`ai.pitchBeat.mode.${candidate}`}
            aria-pressed={props.task === candidate}
            disabled={busy}
            onClick={() => {
              props.onTaskChange(candidate);
            }}
          >
            {t(candidate === "pitch" ? "ai.pitchBeat.pitch" : "ai.pitchBeat.beat")}
          </Button>
        ))}
      </fieldset>

      {!props.backendOnline ? (
        <p data-testid="ai.pitchBeat.offline" className="text-sm text-muted">
          {t("ai.models.offline")}
        </p>
      ) : null}

      {!props.hasSource ? (
        <>
          <p className="text-sm text-muted">{t("ai.pitchBeat.noSource")}</p>
          <UploadEmptyState />
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            {t("ai.excerpt", { seconds: props.excerptSeconds.toFixed(1) })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button data-testid="ai.run" disabled={runDisabled} onClick={props.onRun}>
              {t("ai.run")}
            </Button>
            {busy ? (
              <Button variant="outline" data-testid="ai.cancel" onClick={props.onCancel}>
                {t("ai.cancel")}
              </Button>
            ) : null}
          </div>
        </>
      )}

      <p data-testid="ai.status" aria-live="polite" className="text-sm">
        {statusLine(t, props.status, props.progress)}
      </p>
      {props.status === "error" ? (
        <p data-testid="ai.error" className="text-sm text-red-400">
          {props.errorKey === null ? t("ai.error.failed") : t(props.errorKey)}
        </p>
      ) : null}

      {props.analysis === null ? null : (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            {t(
              props.analysis.analysisKind === "pitch"
                ? "ai.pitchBeat.pitchResult"
                : "ai.pitchBeat.beatResult",
            )}
          </h3>
          <Stats analysis={props.analysis} t={t} />
          {props.analysis.analysisKind === "pitch" ? (
            <PitchCurve analysis={props.analysis} />
          ) : (
            <ol
              data-testid="ai.pitchBeat.beatList"
              dir="ltr"
              className="max-h-48 overflow-auto rounded-md border border-surface bg-bg p-2 text-xs tabular-nums"
            >
              {props.analysis.beatTimesSeconds.map((seconds, index) => (
                <li key={`${String(index)}-${String(seconds)}`}>
                  {t("ai.pitchBeat.timeValue", { seconds: seconds.toFixed(3) })}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}

export function PitchBeatTab({
  backendOnline,
  task,
  onTaskChange,
}: {
  readonly backendOnline: boolean;
  readonly task: AnalysisTask;
  readonly onTaskChange: (task: AnalysisTask) => void;
}): React.ReactElement {
  const original = useSessionStore((state) => state.original);
  const { status, progress, result, errorKey, run, cancel } = useAiJob();
  const analysis = readPitchBeatResult(result);
  const matching = analysis?.analysisKind === task ? analysis : null;
  const excerptSeconds =
    original === null
      ? AI_MAX_EXCERPT_SECONDS
      : Math.min(AI_MAX_EXCERPT_SECONDS, original.samples.length / original.sampleRateHz);

  function handleRun(): void {
    if (
      original === null ||
      pitchBeatRunDisabled({
        backendOnline,
        hasSource: true,
        busy: status === "uploading" || status === "running",
      })
    ) {
      return;
    }
    const endSample = Math.min(
      original.samples.length,
      AI_MAX_EXCERPT_SECONDS * original.sampleRateHz,
    );
    const excerpt: AiExcerptInput = {
      samples: original.samples.slice(0, endSample),
      sampleRateHz: original.sampleRateHz,
      startSample: 0,
      endSample,
    };
    void run(task, excerpt);
  }

  return (
    <PitchBeatView
      backendOnline={backendOnline}
      task={task}
      hasSource={original !== null}
      status={status}
      progress={progress}
      errorKey={errorKey}
      analysis={matching}
      excerptSeconds={excerptSeconds}
      onTaskChange={onTaskChange}
      onRun={handleRun}
      onCancel={() => void cancel()}
    />
  );
}
