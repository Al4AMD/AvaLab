/**
 * Source-separation tab (F14, Wave-5 Plan 03 Task 2).
 *
 * htdemucs returns four mono stems. The job stores each stem as its own WAV,
 * so this view only lists them and installs a selected stem as the processed
 * playback lane. No second inference happens in the browser.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/button";
import { isRecordLike } from "../../session/protocol";
import { useSessionStore } from "../../session/store";
import { loadDemoClip, OfflineError } from "../input/offline";
import { UploadEmptyState } from "../input/upload";
import type { AiExcerptInput, AiModelInfo, AiModelState } from "./aiClient";
import { fetchDenoiseAudio as fetchResultAudio } from "./denoiseTab";
import { type AiJobStatus, useAiJob } from "./useAiJob";

export const SEPARATION_MAX_EXCERPT_SECONDS = 15;
export const SEPARATION_STEM_ORDER = ["drums", "bass", "other", "vocals"] as const;
export type SeparationStemName = (typeof SEPARATION_STEM_ORDER)[number];

export type SeparationStemInfo = {
  readonly name: SeparationStemName;
  readonly audioId: string;
  readonly sampleRateHz: number;
  readonly durationS: number | null;
};

export type SeparationResultInfo = {
  readonly modelId: string | null;
  readonly stems: readonly SeparationStemInfo[];
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isStemName(value: unknown): value is SeparationStemName {
  return typeof value === "string" && (SEPARATION_STEM_ORDER as readonly string[]).includes(value);
}

export function readSeparationResult(result: Record<string, unknown>): SeparationResultInfo | null {
  if (!Array.isArray(result.stems)) {
    return null;
  }
  const byName = new Map<SeparationStemName, SeparationStemInfo>();
  for (const entry of result.stems) {
    if (!isRecordLike(entry) || typeof entry.result_audio_id !== "string") {
      continue;
    }
    if (!isStemName(entry.name) || byName.has(entry.name)) {
      continue;
    }
    byName.set(entry.name, {
      name: entry.name,
      audioId: entry.result_audio_id,
      sampleRateHz: numberOrNull(entry.sample_rate_hz) ?? 0,
      durationS: numberOrNull(entry.duration_s),
    });
  }
  const stems = SEPARATION_STEM_ORDER.flatMap((name) => {
    const stem = byName.get(name);
    return stem === undefined ? [] : [stem];
  });
  if (stems.length === 0) {
    return null;
  }
  const stats = isRecordLike(result.stats) ? result.stats : {};
  return {
    modelId: typeof stats.model_id === "string" ? stats.model_id : null,
    stems,
  };
}

export type FetchStemAudio = (
  audioId: string,
) => Promise<{ samples: Float32Array; sampleRateHz: number }>;

export async function installStemAudio(input: {
  readonly name: SeparationStemName;
  readonly audioId: string;
  readonly fetchAudio: FetchStemAudio;
  readonly setProcessed: (
    samples: Float32Array,
    sampleRateHz: number,
    label: string,
  ) => { ok: true } | { ok: false; code: string };
}): Promise<{ samples: Float32Array; sampleRateHz: number }> {
  const audio = await input.fetchAudio(input.audioId);
  const installed = input.setProcessed(
    audio.samples,
    audio.sampleRateHz,
    `separated-${input.name}`,
  );
  if (!installed.ok) {
    throw new Error(`separation: store rejected stem (${installed.code})`);
  }
  return audio;
}

export type SeparationViewProps = {
  readonly backendOnline: boolean;
  readonly modelState: AiModelState | undefined;
  readonly modelId: string | undefined;
  readonly hasSource: boolean;
  readonly stems: readonly SeparationStemInfo[];
  readonly selectedStem: SeparationStemName | null;
  readonly status: AiJobStatus;
  readonly progress: number;
  readonly errorKey: string | null;
  readonly demoErrorKey: string | null;
  readonly demoLoading: boolean;
  readonly excerptSeconds: number;
  readonly onLoadDemo: () => void;
  readonly onRun: () => void;
  readonly onCancel: () => void;
  readonly onPlayStem: (stem: SeparationStemInfo) => void;
};

export function separationRunDisabled(
  input: Pick<SeparationViewProps, "backendOnline" | "modelState" | "hasSource" | "status">,
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

export function SeparationView(props: SeparationViewProps): React.ReactElement {
  const { t } = useTranslation();
  const busy = props.status === "uploading" || props.status === "running";
  const runDisabled = separationRunDisabled(props);
  const status = statusLine(t, props.status, props.progress);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t("ai.separation.intro")}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          data-testid="ai.separation.loadDemo"
          disabled={props.demoLoading || busy}
          onClick={props.onLoadDemo}
        >
          {props.demoLoading ? t("ai.separation.demoLoading") : t("ai.separation.loadDemo")}
        </Button>
        {props.modelId !== undefined ? (
          <span className="text-xs text-muted" dir="ltr">
            {t("ai.separation.model", { modelId: props.modelId })}
          </span>
        ) : null}
      </div>

      {props.modelState === "missing" ? (
        <p data-testid="ai.separation.modelMissing" className="text-sm text-muted">
          {t("ai.separation.modelMissing")}
        </p>
      ) : null}

      {!props.hasSource ? (
        <>
          <p className="text-sm text-muted">{t("ai.separation.noSource")}</p>
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
          data-testid="ai.separation.progress"
          className="h-2 w-full"
          max={1}
          value={props.progress}
        />
      ) : null}
      <p data-testid="ai.status" aria-live="polite" className="text-sm">
        {status}
      </p>
      {props.errorKey !== null ? (
        <p data-testid="ai.separation.error" className="text-sm text-red-400">
          {t(props.errorKey)}
        </p>
      ) : null}
      {props.demoErrorKey !== null ? (
        <p data-testid="ai.separation.demoError" className="text-sm text-red-400">
          {t(props.demoErrorKey)}
        </p>
      ) : null}

      {props.hasSource ? (
        <p data-testid="ai.separation.eta" className="text-xs text-muted">
          {t("ai.separation.eta")}
        </p>
      ) : null}

      {props.stems.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {props.stems.map((stem) => (
            <li
              key={stem.name}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-surface px-3 py-2"
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{t(`ai.separation.stems.${stem.name}`)}</span>
                <span className="text-xs text-muted" dir="ltr">
                  {t("ai.separation.stemRate", { rate: stem.sampleRateHz / 1_000 })}
                </span>
              </span>
              <Button
                variant={props.selectedStem === stem.name ? "default" : "outline"}
                data-testid={`ai.separation.play.${stem.name}`}
                aria-pressed={props.selectedStem === stem.name}
                onClick={() => {
                  props.onPlayStem(stem);
                }}
              >
                {t("ai.separation.play")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-xs text-muted">{t("ai.caption.approximation")}</p>
    </div>
  );
}

export function SeparationTab({
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
  const [installErrorKey, setInstallErrorKey] = useState<string | null>(null);
  const [selectedStem, setSelectedStem] = useState<SeparationStemName | null>(null);

  useEffect(() => {
    setSelectedStem(null);
    setInstallErrorKey(null);
    if (original === null) {
      setDemoErrorKey(null);
    }
  }, [original]);

  const info = result === null ? null : readSeparationResult(result);
  const stems = info?.stems ?? [];
  const excerptSeconds =
    original === null
      ? SEPARATION_MAX_EXCERPT_SECONDS
      : Math.min(SEPARATION_MAX_EXCERPT_SECONDS, original.samples.length / original.sampleRateHz);

  function handleRun(): void {
    if (
      original === null ||
      separationRunDisabled({
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
      Math.round(SEPARATION_MAX_EXCERPT_SECONDS * original.sampleRateHz),
    );
    const excerpt: AiExcerptInput = {
      samples: original.samples.slice(0, endSample),
      sampleRateHz: original.sampleRateHz,
      startSample: 0,
      endSample,
    };
    setSelectedStem(null);
    setInstallErrorKey(null);
    void run("separation", excerpt);
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

  async function handlePlayStem(stem: SeparationStemInfo): Promise<void> {
    setInstallErrorKey(null);
    try {
      await installStemAudio({
        name: stem.name,
        audioId: stem.audioId,
        fetchAudio: fetchResultAudio,
        setProcessed: useSessionStore.getState().setProcessed,
      });
      setSelectedStem(stem.name);
    } catch {
      setInstallErrorKey("ai.separation.installFailed");
    }
  }

  return (
    <SeparationView
      backendOnline={backendOnline}
      modelState={model?.state}
      modelId={info?.modelId ?? model?.model_id}
      hasSource={original !== null}
      stems={stems}
      selectedStem={selectedStem}
      status={status}
      progress={progress}
      errorKey={installErrorKey ?? errorKey}
      demoErrorKey={demoErrorKey}
      demoLoading={demoLoading}
      excerptSeconds={excerptSeconds}
      onLoadDemo={handleLoadDemo}
      onRun={handleRun}
      onCancel={() => void cancel()}
      onPlayStem={(stem) => void handlePlayStem(stem)}
    />
  );
}
