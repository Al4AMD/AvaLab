/**
 * Super-resolution tab (F14, Wave-5 Plan 02 Task 5).
 *
 * The experiment pairs sampling-rate reduction with two restorers:
 * - a kaiser-sinc baseline that restores the SAMPLE RATE but never invents the
 *   band that downsampling removed (pure `@avalab/dsp` in the worker);
 * - LavaSR, which estimates the missing high band (backend job).
 *
 * The source is band-limited in the worker, kept at the source rate for a
 * fair A/B, and both lanes are compared with the untouched original.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";

import { Button } from "../../components/ui/button";
import type { SuperresBaselineParams } from "../../session/ops";
import { isRecordLike } from "../../session/protocol";
import { useSessionStore } from "../../session/store";
import { loadDemoClip, OfflineError } from "../input/offline";
import { UploadEmptyState } from "../input/upload";
import type { AiExcerptInput, AiModelInfo, AiModelState } from "./aiClient";
import { fetchDenoiseAudio as fetchResultAudio } from "./denoiseTab";
import { ProcessedInstallError, processedInstallErrorKey } from "./installResult";
import { SampleWave } from "./sampleWave";
import { type AiJobStatus, useAiJob } from "./useAiJob";

export type SuperresRestorePath = "sinc" | "lavasr";
export type SuperresLane = "original" | "bandlimited" | "restored";

/** Fixed band-limit targets (Hz) offered by the experiment. */
export const SUPERRES_LOW_RATES_HZ = [8_000, 12_000, 16_000] as const;
export type SuperresLowRateHz = (typeof SUPERRES_LOW_RATES_HZ)[number];

export function isSupportedLowRateHz(value: number): value is SuperresLowRateHz {
  return (SUPERRES_LOW_RATES_HZ as readonly number[]).includes(value);
}

export type SuperresResultInfo = {
  readonly audioId: string;
  readonly modelId: string | null;
  readonly inputRateHz: number | null;
  readonly outputRateHz: number | null;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readSuperresResult(result: Record<string, unknown>): SuperresResultInfo | null {
  if (typeof result.result_audio_id !== "string") {
    return null;
  }
  const stats = isRecordLike(result.stats) ? result.stats : {};
  return {
    audioId: result.result_audio_id,
    modelId: typeof stats.model_id === "string" ? stats.model_id : null,
    inputRateHz: numberOrNull(stats.input_sample_rate_hz),
    outputRateHz: numberOrNull(stats.output_sample_rate_hz),
  };
}

export type SuperresViewProps = {
  readonly backendOnline: boolean;
  readonly modelState: AiModelState | undefined;
  readonly modelId: string | undefined;
  readonly hasSource: boolean;
  readonly lowRateHz: SuperresLowRateHz;
  readonly path: SuperresRestorePath;
  readonly busy: boolean;
  readonly status: AiJobStatus;
  readonly progress: number;
  readonly errorKey: string | null;
  readonly demoErrorKey: string | null;
  readonly demoLoading: boolean;
  readonly hasBandlimited: boolean;
  readonly hasRestored: boolean;
  readonly selectedLane: SuperresLane;
  readonly modelInputRateHz: number | null;
  readonly modelOutputRateHz: number | null;
  readonly excerptSeconds: number;
  readonly waveform?: React.ReactNode;
  readonly onLoadDemo: () => void;
  readonly onLowRateChange: (rate: SuperresLowRateHz) => void;
  readonly onPathChange: (path: SuperresRestorePath) => void;
  readonly onRun: () => void;
  readonly onCancel: () => void;
  readonly onPlayOriginal: () => void;
  readonly onPlayBandlimited: () => void;
  readonly onPlayRestored: () => void;
};

export function superresRunDisabled(
  input: Pick<SuperresViewProps, "path" | "backendOnline" | "modelState" | "hasSource" | "busy">,
): boolean {
  if (!input.hasSource || input.busy) {
    return true;
  }
  return input.path === "lavasr" ? !input.backendOnline || input.modelState !== "available" : false;
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

export function SuperresView(props: SuperresViewProps): React.ReactElement {
  const { t } = useTranslation();
  const busy = props.busy || props.status === "uploading" || props.status === "running";
  const runDisabled = superresRunDisabled({ ...props, busy });
  const status = statusLine(t, props.status, props.progress);
  const inputRate =
    props.modelInputRateHz === null
      ? null
      : props.modelInputRateHz === 0
        ? t("ai.superres.flexibleRate")
        : String(props.modelInputRateHz / 1_000);
  const outputRate =
    props.modelOutputRateHz === null ? null : String(props.modelOutputRateHz / 1_000);
  const rateText = (rate: number): string => t("ai.superres.rateOption", { rate: rate / 1_000 });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t("ai.superres.intro")}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          data-testid="ai.superres.loadDemo"
          disabled={props.demoLoading || busy}
          onClick={props.onLoadDemo}
        >
          {props.demoLoading ? t("ai.superres.demoLoading") : t("ai.superres.loadDemo")}
        </Button>
        {props.modelId !== undefined ? (
          <span className="text-xs text-muted" dir="ltr">
            {t("ai.superres.model", { modelId: props.modelId })}
          </span>
        ) : null}
      </div>

      <fieldset className="flex flex-wrap items-center gap-3 text-sm">
        <legend className="text-xs font-medium">{t("ai.superres.rate")}</legend>
        {SUPERRES_LOW_RATES_HZ.map((rate) => (
          <label key={rate} className="flex items-center gap-1 text-xs">
            <input
              type="radio"
              name="superres-low-rate"
              value={rate}
              checked={props.lowRateHz === rate}
              data-testid={`ai.superres.rate.${String(rate)}`}
              disabled={busy}
              onChange={() => {
                props.onLowRateChange(rate);
              }}
            />
            <span dir="ltr">{rateText(rate)}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-wrap items-center gap-3 text-sm">
        <legend className="text-xs font-medium">{t("ai.superres.path")}</legend>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="radio"
            name="superres-path"
            value="sinc"
            checked={props.path === "sinc"}
            data-testid="ai.superres.path.sinc"
            disabled={busy}
            onChange={() => {
              props.onPathChange("sinc");
            }}
          />
          <span>{t("ai.superres.pathSinc")}</span>
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="radio"
            name="superres-path"
            value="lavasr"
            checked={props.path === "lavasr"}
            data-testid="ai.superres.path.lavasr"
            disabled={busy}
            onChange={() => {
              props.onPathChange("lavasr");
            }}
          />
          <span>{t("ai.superres.pathLavasr")}</span>
        </label>
      </fieldset>

      {props.path === "lavasr" && props.modelState === "missing" ? (
        <p data-testid="ai.superres.modelMissing" className="text-sm text-muted">
          {t("ai.superres.modelMissing")}
        </p>
      ) : null}

      {!props.hasSource ? (
        <>
          <p className="text-sm text-muted">{t("ai.superres.noSource")}</p>
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
          data-testid="ai.superres.progress"
          className="h-2 w-full"
          max={1}
          value={props.progress}
        />
      ) : null}
      <p data-testid="ai.status" aria-live="polite" className="text-sm">
        {status}
      </p>
      {props.errorKey !== null ? (
        <p data-testid="ai.superres.error" className="text-sm text-red-400">
          {t(props.errorKey)}
        </p>
      ) : null}
      {props.demoErrorKey !== null ? (
        <p data-testid="ai.superres.demoError" className="text-sm text-red-400">
          {t(props.demoErrorKey)}
        </p>
      ) : null}

      {inputRate !== null && outputRate !== null ? (
        <p data-testid="ai.superres.rates" dir="ltr" className="text-sm text-muted">
          {t("ai.superres.rates", { input: inputRate, output: outputRate })}
        </p>
      ) : null}

      {props.waveform !== undefined ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{props.waveform}</div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={props.selectedLane === "original" ? "default" : "outline"}
          data-testid="ai.superres.ab.original"
          aria-pressed={props.selectedLane === "original"}
          disabled={!props.hasSource}
          onClick={props.onPlayOriginal}
        >
          {t("ai.superres.ab.original")}
        </Button>
        <Button
          variant={props.selectedLane === "bandlimited" ? "default" : "outline"}
          data-testid="ai.superres.ab.bandlimited"
          aria-pressed={props.selectedLane === "bandlimited"}
          disabled={!props.hasBandlimited}
          onClick={props.onPlayBandlimited}
        >
          {t("ai.superres.ab.bandlimited")}
        </Button>
        <Button
          variant={props.selectedLane === "restored" ? "default" : "outline"}
          data-testid="ai.superres.ab.restored"
          aria-pressed={props.selectedLane === "restored"}
          disabled={!props.hasRestored}
          onClick={props.onPlayRestored}
        >
          {t("ai.superres.ab.restored")}
        </Button>
      </div>

      <p className="text-xs text-muted">{t("ai.superres.pathSincHint")}</p>
      {props.path === "lavasr" ? (
        <p data-testid="ai.superres.caption" className="text-xs text-muted">
          {t("ai.caption.approximation")}
        </p>
      ) : null}
    </div>
  );
}

type AudioSlice = {
  readonly samples: Float32Array;
  readonly sampleRateHz: number;
};

const MAX_EXCERPT_SECONDS = 30;

function deriveSlice(params: SuperresBaselineParams, samples: Float32Array): Promise<AudioSlice> {
  const copy = samples.slice();
  const ticket = useSessionStore.getState().deriveStandalone("superresBaseline", params, {
    buffer: copy.buffer,
    byteOffset: 0,
    byteLength: copy.byteLength,
  });
  return ticket.outcome.then((outcome) => {
    if ("cancelled" in outcome) {
      throw new Error("superres: derivation cancelled");
    }
    const payload = outcome.payload;
    if (payload === undefined) {
      throw new Error("superres: derivation returned no samples");
    }
    return {
      samples: new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4),
      sampleRateHz: outcome.meta.sampleRateHz,
    };
  });
}

export function SuperresTab({
  backendOnline,
  model,
}: {
  readonly backendOnline: boolean;
  readonly model: AiModelInfo | undefined;
}): React.ReactElement {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const original = useSessionStore((state) => state.original);
  const playbackMode = useSessionStore((state) => state.playbackMode);
  const setPlaybackMode = useSessionStore((state) => state.setPlaybackMode);
  const { status, progress, result, errorKey, run, cancel } = useAiJob();

  const [path, setPath] = useState<SuperresRestorePath>("sinc");
  const [lowRateHz, setLowRateHz] = useState<SuperresLowRateHz>(8_000);
  const [bandlimited, setBandlimited] = useState<AudioSlice | null>(null);
  const [restored, setRestored] = useState<AudioSlice | null>(null);
  const [modelRates, setModelRates] = useState<{
    readonly inputRateHz: number | null;
    readonly outputRateHz: number | null;
  } | null>(null);
  const [selectedLane, setSelectedLane] = useState<SuperresLane>("original");
  const [busyLocal, setBusyLocal] = useState(false);
  const [awaitingResult, setAwaitingResult] = useState(false);
  const [localErrorKey, setLocalErrorKey] = useState<string | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoErrorKey, setDemoErrorKey] = useState<string | null>(null);
  const generationRef = useRef(0);
  const installedRef = useRef<string | null>(null);
  const jobSourceHashRef = useRef<string | null>(null);
  const autoDemoRef = useRef(false);

  const info = result === null ? null : readSuperresResult(result);
  const audioId = info?.audioId ?? null;
  const jobBusy = status === "uploading" || status === "running";
  const busy = busyLocal || jobBusy;

  useEffect(() => {
    generationRef.current += 1;
    setBandlimited(null);
    setRestored(null);
    setModelRates(null);
    setAwaitingResult(false);
    setSelectedLane("original");
    setLocalErrorKey(null);
    installedRef.current = null;
    if (original === null) {
      setDemoErrorKey(null);
    }
  }, [original]);

  useEffect(() => {
    const demo = searchParams.get("demo");
    if (demo !== "speech" || autoDemoRef.current) {
      return;
    }
    if (original !== null) {
      autoDemoRef.current = true;
      return;
    }
    autoDemoRef.current = true;
    setDemoLoading(true);
    setDemoErrorKey(null);
    void loadDemoClip("speech").then(
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
  }, [original, searchParams]);

  useEffect(() => {
    if (playbackMode === "original") {
      setSelectedLane("original");
      return;
    }
    setSelectedLane((current) =>
      current === "original" ? (restored !== null ? "restored" : "bandlimited") : current,
    );
  }, [playbackMode, restored]);

  useEffect(() => {
    if (audioId === null || !awaitingResult) {
      return;
    }
    if (installedRef.current === audioId) {
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
          .setProcessed(audio.samples.slice(), audio.sampleRateHz, "superres-lavasr", {
            ...(jobSourceHashRef.current === null ? {} : { sourceHash: jobSourceHashRef.current }),
            sourceStartSample: 0,
          });
        if (!installed.ok) {
          setLocalErrorKey(
            processedInstallErrorKey(
              new ProcessedInstallError(installed.code),
              "ai.superres.installFailed",
            ),
          );
          return;
        }
        installedRef.current = audioId;
        setRestored(audio);
        setModelRates({
          inputRateHz: info?.inputRateHz ?? null,
          outputRateHz: info?.outputRateHz ?? null,
        });
        setSelectedLane("restored");
        setAwaitingResult(false);
      },
      () => {
        if (!cancelled) {
          setLocalErrorKey("ai.superres.installFailed");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [audioId, awaitingResult, info?.inputRateHz, info?.outputRateHz]);

  const excerptSeconds =
    original === null
      ? MAX_EXCERPT_SECONDS
      : Math.min(MAX_EXCERPT_SECONDS, original.samples.length / original.sampleRateHz);

  function installLane(slice: AudioSlice, label: string): boolean {
    const installed = useSessionStore
      .getState()
      .setProcessed(slice.samples.slice(), slice.sampleRateHz, label, {
        ...(jobSourceHashRef.current === null ? {} : { sourceHash: jobSourceHashRef.current }),
        sourceStartSample: 0,
      });
    if (!installed.ok) {
      setLocalErrorKey(
        processedInstallErrorKey(
          new ProcessedInstallError(installed.code),
          "ai.superres.installFailed",
        ),
      );
      return false;
    }
    return true;
  }

  async function handleRun(): Promise<void> {
    if (
      original === null ||
      superresRunDisabled({
        path,
        backendOnline,
        modelState: model?.state,
        hasSource: true,
        busy,
      })
    ) {
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    jobSourceHashRef.current = useSessionStore.getState().inputHash;
    const source = original;
    const endSample = Math.min(
      source.samples.length,
      Math.round(MAX_EXCERPT_SECONDS * source.sampleRateHz),
    );
    setBusyLocal(true);
    setLocalErrorKey(null);
    setRestored(null);
    setModelRates(null);
    setAwaitingResult(false);
    try {
      const low = await deriveSlice(
        { sampleRateHz: source.sampleRateHz, targetRateHz: lowRateHz },
        source.samples.slice(0, endSample),
      );
      if (generationRef.current !== generation) {
        return;
      }
      const band = await deriveSlice(
        { sampleRateHz: lowRateHz, targetRateHz: source.sampleRateHz },
        low.samples,
      );
      if (generationRef.current !== generation) {
        return;
      }
      setBandlimited(band);
      if (path === "sinc") {
        const restoredSlice = { samples: band.samples.slice(), sampleRateHz: band.sampleRateHz };
        setRestored(restoredSlice);
        if (installLane(restoredSlice, "superres-sinc")) {
          setSelectedLane("restored");
        }
        return;
      }
      setAwaitingResult(true);
      const excerpt: AiExcerptInput = {
        samples: band.samples.slice(),
        sampleRateHz: band.sampleRateHz,
        startSample: 0,
        endSample: band.samples.length,
      };
      await run("superres", excerpt);
    } catch {
      if (generationRef.current === generation) {
        setLocalErrorKey("ai.superres.failed");
      }
    } finally {
      if (generationRef.current === generation) {
        setBusyLocal(false);
      }
    }
  }

  function handleLoadDemo(): void {
    setDemoLoading(true);
    setDemoErrorKey(null);
    void loadDemoClip("speech").then(
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

  function handlePlayBandlimited(): void {
    if (bandlimited !== null && installLane(bandlimited, `superres-bandlimited-${lowRateHz}`)) {
      setSelectedLane("bandlimited");
    }
  }

  function handlePlayRestored(): void {
    if (restored !== null && installLane(restored, "superres-restored")) {
      setSelectedLane("restored");
    }
  }

  const waveforms =
    original === null ? undefined : (
      <>
        <SampleWave
          samples={original.samples}
          sampleRateHz={original.sampleRateHz}
          label={t("ai.superres.waveOriginal")}
          testId="ai.superres.wave.original"
        />
        {bandlimited !== null ? (
          <SampleWave
            samples={bandlimited.samples}
            sampleRateHz={bandlimited.sampleRateHz}
            label={t("ai.superres.waveBandlimited", { rate: lowRateHz / 1_000 })}
            testId="ai.superres.wave.bandlimited"
          />
        ) : null}
        {restored !== null ? (
          <SampleWave
            samples={restored.samples}
            sampleRateHz={restored.sampleRateHz}
            label={t("ai.superres.waveRestored")}
            testId="ai.superres.wave.restored"
          />
        ) : null}
      </>
    );

  return (
    <SuperresView
      backendOnline={backendOnline}
      modelState={model?.state}
      modelId={info?.modelId ?? model?.model_id}
      hasSource={original !== null}
      lowRateHz={lowRateHz}
      path={path}
      busy={busy}
      status={status}
      progress={progress}
      errorKey={localErrorKey ?? errorKey}
      demoErrorKey={demoErrorKey}
      demoLoading={demoLoading}
      hasBandlimited={bandlimited !== null}
      hasRestored={restored !== null}
      selectedLane={selectedLane}
      modelInputRateHz={modelRates?.inputRateHz ?? null}
      modelOutputRateHz={modelRates?.outputRateHz ?? null}
      excerptSeconds={excerptSeconds}
      waveform={waveforms}
      onLoadDemo={handleLoadDemo}
      onLowRateChange={(next) => {
        setLowRateHz(next);
        setBandlimited(null);
        setRestored(null);
        setModelRates(null);
        setAwaitingResult(false);
        setLocalErrorKey(null);
        setSelectedLane("original");
        setPlaybackMode("original");
      }}
      onPathChange={(next) => {
        setPath(next);
        setRestored(null);
        setModelRates(null);
        setAwaitingResult(false);
        setLocalErrorKey(null);
        setSelectedLane("original");
        setPlaybackMode("original");
      }}
      onRun={() => void handleRun()}
      onCancel={() => void cancel()}
      onPlayOriginal={() => {
        setPlaybackMode("original");
        setSelectedLane("original");
      }}
      onPlayBandlimited={handlePlayBandlimited}
      onPlayRestored={handlePlayRestored}
    />
  );
}
