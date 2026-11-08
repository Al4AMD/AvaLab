/**
 * AudioSet classification tab (Wave 7 F14).
 *
 * AST is multi-label: every class gets its own sigmoid score. The backend
 * averages scores over non-overlapping 10 s windows, so this view renders the
 * ranked list, the window count and the honest "approximation" caption; it
 * never presents the scores as a probability distribution over one class.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/button";
import { isRecordLike } from "../../session/protocol";
import { useSessionStore } from "../../session/store";
import { loadDemoClip, OfflineError } from "../input/offline";
import { UploadEmptyState } from "../input/upload";
import {
  AI_MAX_EXCERPT_SECONDS,
  type AiExcerptInput,
  type AiModelInfo,
  type AiModelState,
} from "./aiClient";
import { type AiJobStatus, useAiJob } from "./useAiJob";

export type ClassificationLabel = {
  readonly label: string;
  readonly probability: number;
};

export type ClassificationResultInfo = {
  readonly labels: readonly ClassificationLabel[];
  readonly modelId: string | null;
  readonly analyzedS: number | null;
  readonly windowS: number | null;
  readonly windowCount: number | null;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readClassificationResult(
  result: Record<string, unknown>,
): ClassificationResultInfo | null {
  if (result.kind !== "classification" || !Array.isArray(result.labels)) {
    return null;
  }
  const labels: ClassificationLabel[] = [];
  for (const entry of result.labels) {
    if (!isRecordLike(entry) || typeof entry.label !== "string") {
      continue;
    }
    const probability = numberOrNull(entry.probability);
    if (probability === null) {
      continue;
    }
    labels.push({
      label: entry.label,
      probability: Math.min(1, Math.max(0, probability)),
    });
  }
  const stats = isRecordLike(result.stats) ? result.stats : {};
  return {
    labels,
    modelId: typeof stats.model_id === "string" ? stats.model_id : null,
    analyzedS: numberOrNull(stats.analyzed_s),
    windowS: numberOrNull(stats.window_s),
    windowCount: numberOrNull(stats.window_count),
  };
}

export type ClassificationViewProps = {
  readonly backendOnline: boolean;
  readonly modelState: AiModelState | undefined;
  readonly modelId: string | undefined;
  readonly hasSource: boolean;
  readonly result: ClassificationResultInfo | null;
  readonly status: AiJobStatus;
  readonly progress: number;
  readonly errorKey: string | null;
  readonly demoErrorKey: string | null;
  readonly demoLoading: boolean;
  readonly excerptSeconds: number;
  readonly onLoadDemo: () => void;
  readonly onRun: () => void;
  readonly onCancel: () => void;
};

export function classificationRunDisabled(
  input: Pick<ClassificationViewProps, "backendOnline" | "modelState" | "hasSource" | "status">,
): boolean {
  const busy = input.status === "uploading" || input.status === "running";
  return !input.backendOnline || input.modelState !== "available" || !input.hasSource || busy;
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

export function ClassificationView(props: ClassificationViewProps): React.ReactElement {
  const { t } = useTranslation();
  const busy = props.status === "uploading" || props.status === "running";
  const runDisabled = classificationRunDisabled(props);
  const status = statusLine(t, props.status, props.progress);
  const windows =
    props.result?.analyzedS === null ||
    props.result?.analyzedS === undefined ||
    props.result.windowS === null ||
    props.result.windowCount === null
      ? null
      : t("ai.classification.windows", {
          seconds: props.result.analyzedS.toFixed(1),
          count: String(props.result.windowCount),
          window: props.result.windowS.toFixed(1),
        });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t("ai.classification.intro")}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          data-testid="ai.classification.loadDemo"
          disabled={props.demoLoading || busy}
          onClick={props.onLoadDemo}
        >
          {props.demoLoading ? t("ai.classification.demoLoading") : t("ai.classification.loadDemo")}
        </Button>
        {props.modelId !== undefined ? (
          <span className="text-xs text-muted" dir="ltr">
            {t("ai.classification.model", { modelId: props.modelId })}
          </span>
        ) : null}
      </div>

      {props.modelState === "missing" ? (
        <p data-testid="ai.classification.modelMissing" className="text-sm text-muted">
          {t("ai.classification.modelMissing")}
        </p>
      ) : null}

      {!props.hasSource ? (
        <>
          <p className="text-sm text-muted">{t("ai.classification.noSource")}</p>
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

      {busy ? (
        <progress
          data-testid="ai.classification.progress"
          className="h-2 w-full"
          max={1}
          value={props.progress}
        />
      ) : null}
      <p data-testid="ai.status" aria-live="polite" className="text-sm">
        {status}
      </p>
      {props.errorKey !== null ? (
        <p data-testid="ai.classification.error" className="text-sm text-red-400">
          {t(props.errorKey)}
        </p>
      ) : null}
      {props.demoErrorKey !== null ? (
        <p data-testid="ai.classification.demoError" className="text-sm text-red-400">
          {t(props.demoErrorKey)}
        </p>
      ) : null}

      {props.result !== null ? (
        <div className="flex flex-col gap-2 rounded-md border border-surface p-3">
          <h3 className="text-sm font-medium">{t("ai.classification.labelsTitle")}</h3>
          {props.result.labels.length === 0 ? (
            <p data-testid="ai.classification.empty" className="text-sm text-muted">
              {t("ai.classification.empty")}
            </p>
          ) : (
            <ol data-testid="ai.classification.list" className="flex flex-col gap-2">
              {props.result.labels.map((entry, index) => {
                const percent = (entry.probability * 100).toFixed(1);
                return (
                  <li
                    key={`${String(index)}-${entry.label}`}
                    data-testid={`ai.classification.label.${String(index)}`}
                    className="flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span>{entry.label}</span>
                      <span dir="ltr" className="tabular-nums text-muted">
                        {t("ai.classification.labelProbability", { percent })}
                      </span>
                    </div>
                    <div className="h-1.5 rounded bg-surface" aria-hidden="true">
                      <div
                        className="h-full rounded bg-accent"
                        style={{ width: `${String(entry.probability * 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {windows !== null ? (
            <p data-testid="ai.classification.windows" dir="ltr" className="text-xs text-muted">
              {windows}
            </p>
          ) : null}
          <p className="text-xs text-muted">{t("ai.classification.taxonomyNote")}</p>
        </div>
      ) : null}

      <p className="text-xs text-muted">{t("ai.caption.approximation")}</p>
    </div>
  );
}

export function ClassificationTab({
  backendOnline,
  model,
}: {
  readonly backendOnline: boolean;
  readonly model: AiModelInfo | undefined;
}): React.ReactElement {
  const original = useSessionStore((state) => state.original);
  const { status, progress, result, errorKey, run, cancel } = useAiJob();
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoErrorKey, setDemoErrorKey] = useState<string | null>(null);

  const info = result === null ? null : readClassificationResult(result);
  const excerptSeconds =
    original === null
      ? AI_MAX_EXCERPT_SECONDS
      : Math.min(AI_MAX_EXCERPT_SECONDS, original.samples.length / original.sampleRateHz);

  function handleRun(): void {
    if (
      original === null ||
      classificationRunDisabled({
        backendOnline,
        modelState: model?.state,
        hasSource: true,
        status,
      })
    ) {
      return;
    }
    const endSample = Math.min(
      original.samples.length,
      Math.round(AI_MAX_EXCERPT_SECONDS * original.sampleRateHz),
    );
    const excerpt: AiExcerptInput = {
      samples: original.samples.slice(0, endSample),
      sampleRateHz: original.sampleRateHz,
      startSample: 0,
      endSample,
    };
    void run("classification", excerpt, { top_k: 5 });
  }

  function handleLoadDemo(): void {
    setDemoLoading(true);
    setDemoErrorKey(null);
    void loadDemoClip("music").then(
      () => {
        setDemoLoading(false);
      },
      (error: unknown) => {
        setDemoLoading(false);
        setDemoErrorKey(
          error instanceof OfflineError ? error.messageKey : "input.error.demoUnavailable",
        );
      },
    );
  }

  return (
    <ClassificationView
      backendOnline={backendOnline}
      modelState={model?.state}
      modelId={info?.modelId ?? model?.model_id}
      hasSource={original !== null}
      result={info}
      status={status}
      progress={progress}
      errorKey={errorKey}
      demoErrorKey={demoErrorKey}
      demoLoading={demoLoading}
      excerptSeconds={excerptSeconds}
      onLoadDemo={handleLoadDemo}
      onRun={handleRun}
      onCancel={() => void cancel()}
    />
  );
}
