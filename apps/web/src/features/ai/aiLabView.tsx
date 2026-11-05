/**
 * AI lab shell (F14, Wave-5 Plan 01 Task 5).
 *
 * One route, five tabs. Model-specific controls and result views arrive in
 * Plans 02–03; this shell already owns the shared tab URL state, model
 * availability banner, 30 s excerpt run path and job status. Backend absent
 * or a missing model disables the run button instead of failing a request.
 */
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";

import { Button } from "../../components/ui/button";
import { downloadWav } from "../../lib/download";
import { useSessionStore } from "../../session/store";
import { UploadEmptyState } from "../input/upload";
import { TheoryPanel } from "../theory/TheoryPanel";
import { AI_MAX_EXCERPT_SECONDS, type AiModelInfo, type AiModelState, aiClient } from "./aiClient";
import { AI_TASKS, type AiTask, aiTaskFromSearch } from "./aiState";
import { AI_THEORY } from "./aiTheory";
import { AsrTab } from "./asrTab";
import { DenoiseTab } from "./denoiseTab";
import { NeuralCodecTab } from "./neuralCodecTab";
import { SeparationTab } from "./separationTab";
import { SuperresTab } from "./superresTab";
import { useAiJob } from "./useAiJob";

const CONTROL_FOCUS_CLASSES =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function tabLabel(t: TFunction, task: AiTask): string {
  switch (task) {
    case "denoise":
      return t("ai.tab.denoise");
    case "superres":
      return t("ai.tab.superres");
    case "separation":
      return t("ai.tab.separation");
    case "asr":
      return t("ai.tab.asr");
    case "neural-codec":
      return t("ai.tab.neuralCodec");
  }
}

export function aiRunDisabled(input: {
  readonly mlEnabled: boolean;
  readonly hasSource: boolean;
  readonly backendOnline: boolean;
  readonly modelState: AiModelState | undefined;
  readonly busy: boolean;
}): boolean {
  return (
    !input.mlEnabled ||
    !input.hasSource ||
    !input.backendOnline ||
    input.modelState !== "available" ||
    input.busy
  );
}

function modelStateLabel(t: TFunction, state: AiModelState): string {
  switch (state) {
    case "available":
      return t("ai.models.state.available");
    case "missing":
      return t("ai.models.state.missing");
    case "loading":
      return t("ai.models.state.loading");
    case "error":
      return t("ai.models.state.error");
  }
}

function ModelBanner({
  backendOnline,
  mlEnabled,
  model,
  loading,
  loadFailed,
}: {
  readonly backendOnline: boolean;
  readonly mlEnabled: boolean;
  readonly model: AiModelInfo | undefined;
  readonly loading: boolean;
  readonly loadFailed: boolean;
}) {
  const { t } = useTranslation();
  if (!mlEnabled) {
    return (
      <p data-testid="ai.models.banner" className="text-sm text-muted">
        {t("ai.models.disabled")}
      </p>
    );
  }
  if (!backendOnline) {
    return (
      <p data-testid="ai.models.banner" className="text-sm text-muted">
        {t("ai.models.offline")}
      </p>
    );
  }
  if (loading) {
    return (
      <p data-testid="ai.models.banner" className="text-sm text-muted">
        {t("ai.models.loading")}
      </p>
    );
  }
  if (loadFailed) {
    return (
      <p data-testid="ai.models.banner" className="text-sm text-muted">
        {t("ai.models.error")}
      </p>
    );
  }
  if (model === undefined) {
    return (
      <p data-testid="ai.models.banner" className="text-sm text-muted">
        {t("ai.models.unlisted")}
      </p>
    );
  }
  return (
    <div data-testid="ai.models.banner" className="flex flex-col gap-1 text-sm">
      <p>
        {t("ai.models.ready", {
          modelId: model.model_id,
          state: modelStateLabel(t, model.state),
        })}
      </p>
      {model.state === "missing" ? (
        <p className="text-muted">{t("ai.models.missingHint")}</p>
      ) : null}
    </div>
  );
}

export function AiLabView(): React.ReactElement {
  const { t } = useTranslation();
  const original = useSessionStore((state) => state.original);
  const processed = useSessionStore((state) => state.processed);
  const backendOnline = useSessionStore((state) => state.backendOnline);
  const [searchParams, setSearchParams] = useSearchParams();
  const task = aiTaskFromSearch(`?${searchParams.toString()}`);
  const { status, progress, result, errorKey, run, cancel } = useAiJob();

  const [models, setModels] = useState<readonly AiModelInfo[] | null>(null);
  const [mlEnabled, setMlEnabled] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsFailed, setModelsFailed] = useState(false);

  useEffect(() => {
    if (!backendOnline) {
      setModels(null);
      setModelsLoading(false);
      setModelsFailed(false);
      return;
    }
    let cancelled = false;
    setModelsLoading(true);
    setModelsFailed(false);
    void aiClient.getModels().then(
      (response) => {
        if (!cancelled) {
          setMlEnabled(response.ml_enabled);
          setModels(response.ml_enabled ? response.models : []);
          setModelsLoading(false);
        }
      },
      () => {
        if (!cancelled) {
          setModels(null);
          setModelsLoading(false);
          setModelsFailed(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [backendOnline]);

  const model = models?.find((candidate) => candidate.task === task);
  const busy = status === "uploading" || status === "running";
  const runDisabled = aiRunDisabled({
    mlEnabled,
    hasSource: original !== null,
    backendOnline,
    modelState: model?.state,
    busy,
  });

  function selectTask(next: AiTask): void {
    const params = new URLSearchParams(searchParams);
    params.set("task", next);
    setSearchParams(params);
  }

  function runSelected(): void {
    if (original === null || !mlEnabled) {
      return;
    }
    const endSample = Math.min(
      original.samples.length,
      AI_MAX_EXCERPT_SECONDS * original.sampleRateHz,
    );
    void run(task, {
      samples: original.samples.slice(0, endSample),
      sampleRateHz: original.sampleRateHz,
      startSample: 0,
      endSample,
    });
  }

  const excerptSeconds =
    original === null
      ? AI_MAX_EXCERPT_SECONDS
      : Math.min(AI_MAX_EXCERPT_SECONDS, original.samples.length / original.sampleRateHz);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold">{t("tool.ai.title")}</h2>
        {processed !== null ? (
          <Button
            variant="outline"
            data-testid="ai.export.wav"
            onClick={() => {
              downloadWav(
                processed.samples,
                processed.sampleRateHz,
                `avalab-ai-${processed.label}.wav`,
              );
            }}
          >
            {t("ai.export.wav")}
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted">{t("ai.intro")}</p>

      <div role="tablist" aria-label={t("ai.tabsLabel")} className="flex flex-wrap gap-2">
        {AI_TASKS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={candidate === task}
            data-testid={`ai.tab.${candidate}`}
            className={`rounded-md border border-surface px-3 py-1.5 text-sm ${CONTROL_FOCUS_CLASSES} ${
              candidate === task ? "bg-surface text-text" : "text-muted hover:bg-surface"
            }`}
            onClick={() => {
              selectTask(candidate);
            }}
          >
            {tabLabel(t, candidate)}
          </button>
        ))}
      </div>

      <ModelBanner
        backendOnline={backendOnline}
        mlEnabled={mlEnabled}
        model={model}
        loading={modelsLoading}
        loadFailed={modelsFailed}
      />

      {task === "denoise" ? (
        <DenoiseTab backendOnline={backendOnline} model={model} />
      ) : task === "superres" ? (
        <SuperresTab backendOnline={backendOnline} model={model} />
      ) : task === "separation" ? (
        <SeparationTab backendOnline={backendOnline} model={model} />
      ) : task === "asr" ? (
        <AsrTab backendOnline={backendOnline} model={model} />
      ) : task === "neural-codec" ? (
        <NeuralCodecTab backendOnline={backendOnline} model={model} />
      ) : original === null ? (
        <UploadEmptyState />
      ) : (
        <div className="flex flex-col gap-3 rounded-md border border-surface p-3">
          <p className="text-sm text-muted">
            {t("ai.excerpt", { seconds: excerptSeconds.toFixed(1) })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button data-testid="ai.run" disabled={runDisabled} onClick={runSelected}>
              {t("ai.run")}
            </Button>
            {busy ? (
              <Button variant="outline" data-testid="ai.cancel" onClick={() => void cancel()}>
                {t("ai.cancel")}
              </Button>
            ) : null}
          </div>

          <p data-testid="ai.status" aria-live="polite" className="text-sm">
            {status === "uploading" ? t("ai.job.uploading") : null}
            {status === "running"
              ? t("ai.job.running", { percent: Math.round(progress * 100) })
              : null}
            {status === "done" ? t("ai.job.done") : null}
            {status === "cancelled" ? t("ai.job.cancelled") : null}
          </p>
          {status === "error" ? (
            <p data-testid="ai.error" className="text-sm text-red-400">
              {errorKey === null ? t("ai.error.failed") : t(errorKey)}
            </p>
          ) : null}

          {result !== null ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{t("ai.result.title")}</h3>
              <pre
                data-testid="ai.result"
                dir="ltr"
                className="max-h-64 overflow-auto rounded bg-bg p-2 text-xs"
              >
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      )}

      <TheoryPanel titleKey={AI_THEORY[task].titleKey} sections={AI_THEORY[task].sections} />

      <p className="text-xs text-muted">{t("ai.disclaimer")}</p>
    </section>
  );
}
