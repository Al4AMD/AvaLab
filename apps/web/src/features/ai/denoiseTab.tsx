/**
 * Denoise tab (F14, Wave-5 Plan 02 Task 2).
 *
 * The backend owns model inference (DPDFNet at 48 kHz); this view only
 * prepares the ≤30 s excerpt, drives the shared AI job hook, and installs the
 * returned WAV as the processed playback lane. The model id and RMS stats
 * come from the job result; nothing here invents a quality number.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveBaseUrl } from "../../api/client";
import { Button } from "../../components/ui/button";
import { isRecordLike } from "../../session/protocol";
import { useSessionStore } from "../../session/store";
import { browserDecodeWav, monoDownmix } from "../input/ingest";
import { loadDemoClip, OfflineError } from "../input/offline";
import { UploadEmptyState } from "../input/upload";
import {
  AI_MAX_EXCERPT_SECONDS,
  type AiExcerptInput,
  type AiModelInfo,
  type AiModelState,
} from "./aiClient";
import { SampleWave } from "./sampleWave";
import { type AiJobStatus, useAiJob } from "./useAiJob";

export type DenoiseResultInfo = {
  readonly audioId: string;
  readonly modelId: string | null;
  readonly rmsInDb: number | null;
  readonly rmsOutDb: number | null;
};

export type DenoiseViewProps = {
  readonly backendOnline: boolean;
  readonly modelState: AiModelState | undefined;
  readonly modelId: string | undefined;
  readonly hasSource: boolean;
  readonly hasProcessed: boolean;
  readonly playbackMode: "original" | "processed";
  readonly status: AiJobStatus;
  readonly progress: number;
  readonly errorKey: string | null;
  readonly demoErrorKey: string | null;
  readonly demoLoading: boolean;
  readonly rmsInDb: number | null;
  readonly rmsOutDb: number | null;
  readonly excerptSeconds: number;
  readonly waveform?: React.ReactNode;
  readonly onLoadDemo: () => void;
  readonly onRun: () => void;
  readonly onCancel: () => void;
  readonly onPlayOriginal: () => void;
  readonly onPlayDenoised: () => void;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readDenoiseResult(result: Record<string, unknown>): DenoiseResultInfo | null {
  if (typeof result.result_audio_id !== "string") {
    return null;
  }
  const stats = isRecordLike(result.stats) ? result.stats : {};
  return {
    audioId: result.result_audio_id,
    modelId: typeof stats.model_id === "string" ? stats.model_id : null,
    rmsInDb: numberOrNull(stats.rms_in_db),
    rmsOutDb: numberOrNull(stats.rms_out_db),
  };
}

export type FetchDenoiseAudio = (
  audioId: string,
) => Promise<{ samples: Float32Array; sampleRateHz: number }>;

/** Fetch a job's result WAV and decode it through the shared ingest seam. */
export function fetchDenoiseAudio(
  audioId: string,
  fetchFn: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<{ samples: Float32Array; sampleRateHz: number }> {
  const base = resolveBaseUrl().replace(/\/$/, "");
  return fetchFn(`${base}/audio/${encodeURIComponent(audioId)}`).then(async (response) => {
    if (!response.ok) {
      throw new Error(`denoise: result audio answered ${String(response.status)}`);
    }
    const decoded = await browserDecodeWav(await response.arrayBuffer());
    return { samples: monoDownmix(decoded), sampleRateHz: decoded.sampleRate };
  });
}

export async function installDenoiseAudio(input: {
  readonly audioId: string;
  readonly label: string;
  readonly fetchAudio: FetchDenoiseAudio;
  readonly setProcessed: (
    samples: Float32Array,
    sampleRateHz: number,
    label: string,
  ) => { ok: true } | { ok: false; code: string };
}): Promise<{ samples: Float32Array; sampleRateHz: number }> {
  const audio = await input.fetchAudio(input.audioId);
  const installed = input.setProcessed(audio.samples, audio.sampleRateHz, input.label);
  if (!installed.ok) {
    throw new Error(`denoise: store rejected result (${installed.code})`);
  }
  return audio;
}

export function denoiseRunDisabled(
  input: Pick<DenoiseViewProps, "backendOnline" | "modelState" | "hasSource" | "status">,
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

function rmsLine(
  t: ReturnType<typeof useTranslation>["t"],
  input: number | null,
  output: number | null,
): string | null {
  if (input === null && output === null) {
    return null;
  }
  return t("ai.denoise.rms", {
    input: input === null ? "—" : input.toFixed(1),
    output: output === null ? "—" : output.toFixed(1),
  });
}

export function DenoiseView(props: DenoiseViewProps): React.ReactElement {
  const { t } = useTranslation();
  const busy = props.status === "uploading" || props.status === "running";
  const runDisabled = denoiseRunDisabled(props);
  const rms = rmsLine(t, props.rmsInDb, props.rmsOutDb);
  const status = statusLine(t, props.status, props.progress);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t("ai.denoise.intro")}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          data-testid="ai.denoise.loadDemo"
          disabled={props.demoLoading || busy}
          onClick={props.onLoadDemo}
        >
          {props.demoLoading ? t("ai.denoise.demoLoading") : t("ai.denoise.loadDemo")}
        </Button>
        {props.modelId !== undefined ? (
          <span className="text-xs text-muted" dir="ltr">
            {t("ai.denoise.model", { modelId: props.modelId })}
          </span>
        ) : null}
      </div>

      {props.modelState === "missing" ? (
        <p data-testid="ai.denoise.modelMissing" className="text-sm text-muted">
          {t("ai.denoise.modelMissing")}
        </p>
      ) : null}

      {!props.hasSource ? (
        <>
          <p className="text-sm text-muted">{t("ai.denoise.noSource")}</p>
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
          data-testid="ai.denoise.progress"
          className="h-2 w-full"
          max={1}
          value={props.progress}
        />
      ) : null}
      <p data-testid="ai.status" aria-live="polite" className="text-sm">
        {status}
      </p>
      {props.errorKey !== null ? (
        <p data-testid="ai.error" className="text-sm text-red-400">
          {t(props.errorKey)}
        </p>
      ) : null}
      {props.demoErrorKey !== null ? (
        <p data-testid="ai.denoise.demoError" className="text-sm text-red-400">
          {t(props.demoErrorKey)}
        </p>
      ) : null}

      {props.waveform !== undefined ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{props.waveform}</div>
      ) : null}

      {rms !== null ? (
        <p data-testid="ai.denoise.rms" dir="ltr" className="text-sm text-muted">
          {rms}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={props.playbackMode === "original" ? "default" : "outline"}
          data-testid="ai.denoise.ab.original"
          aria-pressed={props.playbackMode === "original"}
          disabled={!props.hasSource}
          onClick={props.onPlayOriginal}
        >
          {t("ai.denoise.ab.original")}
        </Button>
        <Button
          variant={props.playbackMode === "processed" ? "default" : "outline"}
          data-testid="ai.denoise.ab.denoised"
          aria-pressed={props.playbackMode === "processed"}
          disabled={!props.hasProcessed}
          onClick={props.onPlayDenoised}
        >
          {t("ai.denoise.ab.denoised")}
        </Button>
      </div>

      <p className="text-xs text-muted">{t("ai.caption.approximation")}</p>
    </div>
  );
}

export function DenoiseTab({
  backendOnline,
  model,
}: {
  readonly backendOnline: boolean;
  readonly model: AiModelInfo | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const original = useSessionStore((state) => state.original);
  const processed = useSessionStore((state) => state.processed);
  const playbackMode = useSessionStore((state) => state.playbackMode);
  const setPlaybackMode = useSessionStore((state) => state.setPlaybackMode);
  const { status, progress, result, errorKey, run, cancel } = useAiJob();
  const installedRef = useRef<string | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoErrorKey, setDemoErrorKey] = useState<string | null>(null);
  const [installErrorKey, setInstallErrorKey] = useState<string | null>(null);

  const info = result === null ? null : readDenoiseResult(result);
  const audioId = info?.audioId ?? null;

  useEffect(() => {
    if (audioId === null) {
      installedRef.current = null;
      return;
    }
    if (installedRef.current === audioId) {
      return;
    }
    let cancelled = false;
    void installDenoiseAudio({
      audioId,
      label: "denoise",
      fetchAudio: fetchDenoiseAudio,
      setProcessed: useSessionStore.getState().setProcessed,
    }).then(
      () => {
        if (!cancelled) {
          installedRef.current = audioId;
        }
      },
      () => {
        if (!cancelled) {
          setInstallErrorKey("ai.denoise.installFailed");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [audioId]);

  const excerptSeconds =
    original === null
      ? AI_MAX_EXCERPT_SECONDS
      : Math.min(AI_MAX_EXCERPT_SECONDS, original.samples.length / original.sampleRateHz);

  function handleRun(): void {
    if (
      original === null ||
      denoiseRunDisabled({ backendOnline, modelState: model?.state, hasSource: true, status })
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
    setInstallErrorKey(null);
    void run("denoise", excerpt);
  }

  function handleLoadDemo(): void {
    setDemoLoading(true);
    setDemoErrorKey(null);
    void loadDemoClip("speechNoisy").then(
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

  const waveform =
    original === null && processed === null ? undefined : (
      <>
        {original !== null ? (
          <SampleWave
            samples={original.samples}
            sampleRateHz={original.sampleRateHz}
            label={t("ai.denoise.waveOriginal")}
            testId="ai.denoise.wave.original"
          />
        ) : null}
        {processed !== null ? (
          <SampleWave
            samples={processed.samples}
            sampleRateHz={processed.sampleRateHz}
            label={t("ai.denoise.waveDenoised")}
            testId="ai.denoise.wave.denoised"
          />
        ) : null}
      </>
    );

  return (
    <DenoiseView
      backendOnline={backendOnline}
      modelState={model?.state}
      modelId={info?.modelId ?? model?.model_id}
      hasSource={original !== null}
      hasProcessed={processed !== null}
      playbackMode={playbackMode}
      status={status}
      progress={progress}
      errorKey={installErrorKey ?? errorKey}
      demoErrorKey={demoErrorKey}
      demoLoading={demoLoading}
      rmsInDb={info?.rmsInDb ?? null}
      rmsOutDb={info?.rmsOutDb ?? null}
      excerptSeconds={excerptSeconds}
      waveform={waveform}
      onLoadDemo={handleLoadDemo}
      onRun={handleRun}
      onCancel={() => void cancel()}
      onPlayOriginal={() => {
        setPlaybackMode("original");
      }}
      onPlayDenoised={() => {
        setPlaybackMode("processed");
      }}
    />
  );
}
