/**
 * Neural-codec tab (F14, Wave-5 Plan 03 Task 6).
 *
 * Encodec is an A/B experiment, not a bit-exact codec. The backend returns a
 * decoded WAV; this tab installs it in the processed lane, compares it with
 * the source excerpt, and adds one measured SNR point to the F05 rate–
 * distortion chart. Stream size and bitrate are estimates from the requested
 * bandwidth and are labelled as such.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/button";
import { isRecordLike } from "../../session/protocol";
import { useSessionStore } from "../../session/store";
import { type ComparisonRow, publishedCodecComparisonRows } from "../codecLab/comparison";
import { RateDistortionChart } from "../codecLab/rateDistortionChart";
import { UploadEmptyState } from "../input/upload";
import { computeQualityMetrics } from "../metrics/metrics";
import {
  AI_MAX_EXCERPT_SECONDS,
  type AiExcerptInput,
  type AiModelInfo,
  type AiModelState,
} from "./aiClient";
import { fetchDenoiseAudio as fetchResultAudio } from "./denoiseTab";
import { type AiJobStatus, useAiJob } from "./useAiJob";

export const NEURAL_CODEC_BANDWIDTHS = [1.5, 3, 6, 12, 24] as const;
export type NeuralCodecBandwidthKbps = (typeof NEURAL_CODEC_BANDWIDTHS)[number];

export function isNeuralCodecBandwidth(value: number): value is NeuralCodecBandwidthKbps {
  return (NEURAL_CODEC_BANDWIDTHS as readonly number[]).includes(value);
}

export type NeuralCodecResultInfo = {
  readonly audioId: string;
  readonly modelId: string | null;
  readonly bandwidthKbps: number | null;
  readonly estimatedSizeBytes: number | null;
  readonly estimatedBitrateKbps: number | null;
  readonly durationS: number | null;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readNeuralCodecResult(
  result: Record<string, unknown>,
): NeuralCodecResultInfo | null {
  if (typeof result.result_audio_id !== "string") {
    return null;
  }
  const stats = isRecordLike(result.stats) ? result.stats : {};
  return {
    audioId: result.result_audio_id,
    modelId: typeof stats.model_id === "string" ? stats.model_id : null,
    bandwidthKbps: numberOrNull(stats.bandwidth_kbps),
    estimatedSizeBytes: numberOrNull(stats.estimated_size_bytes),
    estimatedBitrateKbps: numberOrNull(stats.estimated_bitrate_kbps),
    durationS: numberOrNull(stats.duration_s),
  };
}

export type NeuralCodecViewProps = {
  readonly backendOnline: boolean;
  readonly modelState: AiModelState | undefined;
  readonly modelId: string | undefined;
  readonly hasSource: boolean;
  readonly bandwidthKbps: NeuralCodecBandwidthKbps;
  readonly result: NeuralCodecResultInfo | null;
  readonly snrDb: number | null;
  readonly decodedReady: boolean;
  readonly playbackMode: "original" | "processed";
  readonly status: AiJobStatus;
  readonly progress: number;
  readonly errorKey: string | null;
  readonly excerptSeconds: number;
  readonly chart?: React.ReactNode;
  readonly onBandwidthChange: (bandwidth: NeuralCodecBandwidthKbps) => void;
  readonly onRun: () => void;
  readonly onCancel: () => void;
  readonly onPlayOriginal: () => void;
  readonly onPlayDecoded: () => void;
};

export function neuralCodecRunDisabled(
  input: Pick<NeuralCodecViewProps, "backendOnline" | "modelState" | "hasSource" | "status">,
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

function StatRow({
  label,
  value,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly testId: string;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd data-testid={testId} dir="ltr" className="tabular-nums">
        {value}
      </dd>
    </div>
  );
}

export function NeuralCodecView(props: NeuralCodecViewProps): React.ReactElement {
  const { t } = useTranslation();
  const busy = props.status === "uploading" || props.status === "running";
  const runDisabled = neuralCodecRunDisabled(props);
  const status = statusLine(t, props.status, props.progress);
  const result = props.result;
  const decodedSelected = props.decodedReady && props.playbackMode === "processed";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t("ai.neuralCodec.intro")}</p>

      {props.modelId !== undefined ? (
        <span className="text-xs text-muted" dir="ltr">
          {t("ai.neuralCodec.model", { modelId: props.modelId })}
        </span>
      ) : null}
      {props.modelState === "missing" ? (
        <p data-testid="ai.neuralCodec.modelMissing" className="text-sm text-muted">
          {t("ai.neuralCodec.modelMissing")}
        </p>
      ) : null}

      {!props.hasSource ? (
        <>
          <p className="text-sm text-muted">{t("ai.neuralCodec.noSource")}</p>
          <UploadEmptyState />
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            {t("ai.excerpt", { seconds: props.excerptSeconds.toFixed(1) })}
          </p>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t("ai.neuralCodec.bandwidth")}</span>
            <select
              data-testid="ai.neuralCodec.bandwidth"
              className="rounded-md border border-surface bg-bg px-2 py-1"
              value={props.bandwidthKbps}
              disabled={busy}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (isNeuralCodecBandwidth(next)) {
                  props.onBandwidthChange(next);
                }
              }}
            >
              {NEURAL_CODEC_BANDWIDTHS.map((bandwidth) => (
                <option key={bandwidth} value={bandwidth}>
                  {t("ai.neuralCodec.bandwidthOption", { kbps: bandwidth.toFixed(1) })}
                </option>
              ))}
            </select>
          </label>
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
          data-testid="ai.neuralCodec.progress"
          className="h-2 w-full"
          max={1}
          value={props.progress}
        />
      ) : null}
      <p data-testid="ai.status" aria-live="polite" className="text-sm">
        {status}
      </p>
      {props.errorKey !== null ? (
        <p data-testid="ai.neuralCodec.error" className="text-sm text-red-400">
          {t(props.errorKey)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={decodedSelected ? "outline" : "default"}
          data-testid="ai.neuralCodec.ab.original"
          aria-pressed={!decodedSelected}
          disabled={!props.hasSource}
          onClick={props.onPlayOriginal}
        >
          {t("ai.neuralCodec.ab.original")}
        </Button>
        <Button
          variant={decodedSelected ? "default" : "outline"}
          data-testid="ai.neuralCodec.ab.decoded"
          aria-pressed={decodedSelected}
          disabled={!props.decodedReady}
          onClick={props.onPlayDecoded}
        >
          {t("ai.neuralCodec.ab.decoded")}
        </Button>
      </div>

      {result !== null ? (
        <dl
          data-testid="ai.neuralCodec.stats"
          className="grid grid-cols-1 gap-1 rounded-md border border-surface p-3 text-sm"
        >
          <StatRow
            label={t("ai.neuralCodec.stats.bandwidth")}
            value={t("ai.neuralCodec.stats.bandwidthValue", {
              kbps: result.bandwidthKbps === null ? "—" : result.bandwidthKbps.toFixed(1),
            })}
            testId="ai.neuralCodec.stats.bandwidth"
          />
          <StatRow
            label={t("ai.neuralCodec.stats.bitrate")}
            value={
              result.estimatedBitrateKbps === null
                ? "—"
                : t("ai.neuralCodec.stats.bitrateValue", {
                    kbps: result.estimatedBitrateKbps.toFixed(1),
                  })
            }
            testId="ai.neuralCodec.stats.bitrate"
          />
          <StatRow
            label={t("ai.neuralCodec.stats.size")}
            value={
              result.estimatedSizeBytes === null
                ? "—"
                : t("ai.neuralCodec.stats.sizeValue", {
                    bytes: result.estimatedSizeBytes.toFixed(0),
                  })
            }
            testId="ai.neuralCodec.stats.size"
          />
          <StatRow
            label={t("ai.neuralCodec.stats.duration")}
            value={
              result.durationS === null
                ? "—"
                : t("ai.neuralCodec.stats.durationValue", {
                    seconds: result.durationS.toFixed(2),
                  })
            }
            testId="ai.neuralCodec.stats.duration"
          />
          {props.snrDb !== null ? (
            <StatRow
              label={t("ai.neuralCodec.stats.snr")}
              value={t("ai.neuralCodec.stats.snrValue", { db: props.snrDb.toFixed(2) })}
              testId="ai.neuralCodec.stats.snr"
            />
          ) : null}
        </dl>
      ) : null}

      {props.chart !== undefined ? (
        <div className="flex flex-col gap-2 rounded-md border border-surface p-3">
          <h3 className="text-sm font-medium">{t("ai.neuralCodec.chart.title")}</h3>
          {props.chart}
        </div>
      ) : null}

      <p className="text-xs text-muted">{t("ai.neuralCodec.estimatedNote")}</p>
      <p className="text-xs text-muted">{t("ai.caption.approximation")}</p>
    </div>
  );
}

export function NeuralCodecTab({
  backendOnline,
  model,
}: {
  readonly backendOnline: boolean;
  readonly model: AiModelInfo | undefined;
}): React.ReactElement {
  const original = useSessionStore((state) => state.original);
  const processed = useSessionStore((state) => state.processed);
  const playbackMode = useSessionStore((state) => state.playbackMode);
  const setPlaybackMode = useSessionStore((state) => state.setPlaybackMode);
  const { status, progress, result, errorKey, run, cancel } = useAiJob();
  const [bandwidthKbps, setBandwidthKbps] = useState<NeuralCodecBandwidthKbps>(6);
  const [installedAudioId, setInstalledAudioId] = useState<string | null>(null);
  const [point, setPoint] = useState<{ bitrateKbps: number; snrDb: number } | null>(null);
  const [localErrorKey, setLocalErrorKey] = useState<string | null>(null);
  const installedRef = useRef<string | null>(null);
  const [codecRows, setCodecRows] = useState<readonly ComparisonRow[]>(() =>
    publishedCodecComparisonRows(original),
  );

  useEffect(() => {
    setCodecRows(publishedCodecComparisonRows(original));
    setInstalledAudioId(null);
    setPoint(null);
    setLocalErrorKey(null);
    installedRef.current = null;
  }, [original]);

  const info = result === null ? null : readNeuralCodecResult(result);
  const audioId = info?.audioId ?? null;
  const resultBandwidth = info?.bandwidthKbps ?? null;
  const resultBitrate = info?.estimatedBitrateKbps ?? null;
  const label = resultBandwidth === null ? null : `encodec-${resultBandwidth.toFixed(1)}kbps`;

  useEffect(() => {
    if (audioId === null || label === null || installedRef.current === audioId) {
      return;
    }
    const source = useSessionStore.getState().original;
    if (source === null) {
      return;
    }
    let cancelled = false;
    void fetchResultAudio(audioId).then(
      (audio) => {
        if (cancelled) {
          return;
        }
        const installed = useSessionStore
          .getState()
          .setProcessed(audio.samples.slice(), audio.sampleRateHz, label);
        if (!installed.ok) {
          setLocalErrorKey("ai.neuralCodec.installFailed");
          return;
        }
        const count = Math.min(source.samples.length, audio.samples.length);
        if (count === 0) {
          setLocalErrorKey("ai.neuralCodec.metricsFailed");
          return;
        }
        try {
          const metrics = computeQualityMetrics(
            source.samples.slice(0, count),
            audio.samples.slice(0, count),
            audio.sampleRateHz,
          );
          setPoint({
            bitrateKbps: resultBitrate ?? resultBandwidth ?? 0,
            snrDb: metrics.snrDb,
          });
        } catch {
          setLocalErrorKey("ai.neuralCodec.metricsFailed");
          return;
        }
        installedRef.current = audioId;
        setInstalledAudioId(audioId);
      },
      () => {
        if (!cancelled) {
          setLocalErrorKey("ai.neuralCodec.installFailed");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [audioId, label, resultBandwidth, resultBitrate]);

  const excerptSeconds =
    original === null
      ? AI_MAX_EXCERPT_SECONDS
      : Math.min(AI_MAX_EXCERPT_SECONDS, original.samples.length / original.sampleRateHz);
  const decodedReady =
    audioId !== null &&
    installedAudioId === audioId &&
    label !== null &&
    processed?.label === label;

  function handleRun(): void {
    if (
      original === null ||
      neuralCodecRunDisabled({
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
    installedRef.current = null;
    setInstalledAudioId(null);
    setPoint(null);
    setLocalErrorKey(null);
    void run("neural-codec", excerpt, { bandwidth_kbps: bandwidthKbps });
  }

  const chart =
    point === null ? undefined : (
      <RateDistortionChart
        rows={codecRows}
        extraPoints={[
          {
            labelKey: "ai.neuralCodec.point",
            bitrateKbps: point.bitrateKbps,
            snrDb: point.snrDb,
          },
        ]}
      />
    );

  return (
    <NeuralCodecView
      backendOnline={backendOnline}
      modelState={model?.state}
      modelId={info?.modelId ?? model?.model_id}
      hasSource={original !== null}
      bandwidthKbps={bandwidthKbps}
      result={info}
      snrDb={point?.snrDb ?? null}
      decodedReady={decodedReady}
      playbackMode={playbackMode}
      status={status}
      progress={progress}
      errorKey={localErrorKey ?? errorKey}
      excerptSeconds={excerptSeconds}
      chart={chart}
      onBandwidthChange={setBandwidthKbps}
      onRun={handleRun}
      onCancel={() => void cancel()}
      onPlayOriginal={() => {
        setPlaybackMode("original");
      }}
      onPlayDecoded={() => {
        if (decodedReady) {
          setPlaybackMode("processed");
        }
      }}
    />
  );
}
