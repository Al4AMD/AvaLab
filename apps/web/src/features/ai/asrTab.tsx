/**
 * ASR tab (F14, Wave-5 Plan 03 Task 4).
 *
 * The backend runs Whisper tiny; this view shows the transcript, timestamped
 * segments, and — when the bundled speech demo is loaded — the WER against
 * the shipped reference transcript. The reference is static teaching data,
 * so it is fetched from `/demo/`, never from the API.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/button";
import { isRecordLike } from "../../session/protocol";
import { type SessionSource, useSessionStore } from "../../session/store";
import { loadDemoClip, OfflineError } from "../input/offline";
import { UploadEmptyState } from "../input/upload";
import {
  AI_MAX_EXCERPT_SECONDS,
  type AiExcerptInput,
  type AiModelInfo,
  type AiModelState,
} from "./aiClient";
import { type AiJobStatus, useAiJob } from "./useAiJob";
import { wordErrorRate } from "./wer";

export const REFERENCE_TRANSCRIPT_URL = "/demo/speech-kathleen-19s.txt";

export type ReferenceStatus = "idle" | "loading" | "ready" | "missing" | "empty";

export type AsrSegment = {
  readonly startS: number;
  readonly endS: number;
  readonly text: string;
};

export type AsrResultInfo = {
  readonly text: string;
  readonly language: string | null;
  readonly modelId: string | null;
  readonly segments: readonly AsrSegment[];
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readAsrResult(result: Record<string, unknown>): AsrResultInfo | null {
  if (typeof result.text !== "string" || result.text.trim() === "") {
    return null;
  }
  const segments: AsrSegment[] = [];
  if (Array.isArray(result.segments)) {
    for (const entry of result.segments) {
      if (!isRecordLike(entry) || typeof entry.text !== "string") {
        continue;
      }
      const startS = numberOrNull(entry.start_s);
      const endS = numberOrNull(entry.end_s);
      if (startS === null || endS === null) {
        continue;
      }
      segments.push({ startS, endS, text: entry.text });
    }
  }
  const stats = isRecordLike(result.stats) ? result.stats : {};
  return {
    text: result.text.trim(),
    language: typeof result.language === "string" ? result.language : null,
    modelId: typeof stats.model_id === "string" ? stats.model_id : null,
    segments,
  };
}

export type ReferenceFetch = (url: string) => Promise<Response>;

export async function fetchReferenceTranscript(fetchFn: ReferenceFetch = fetch): Promise<string> {
  const response = await fetchFn(REFERENCE_TRANSCRIPT_URL);
  if (!response.ok) {
    throw new Error(`asr: reference answered ${String(response.status)}`);
  }
  return response.text();
}

export function usesReferenceTranscript(
  source: Pick<SessionSource, "sourceKind" | "demoId"> | null,
): boolean {
  return source?.sourceKind === "demoClip" && source.demoId === "speech";
}

export type AsrViewProps = {
  readonly backendOnline: boolean;
  readonly modelState: AiModelState | undefined;
  readonly modelId: string | undefined;
  readonly hasSource: boolean;
  readonly transcript: string | null;
  readonly segments: readonly AsrSegment[];
  readonly language: string | null;
  readonly referenceStatus: ReferenceStatus;
  readonly referenceText: string | null;
  readonly wer: number | null;
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

export function asrRunDisabled(
  input: Pick<AsrViewProps, "backendOnline" | "modelState" | "hasSource" | "status">,
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

export function AsrView(props: AsrViewProps): React.ReactElement {
  const { t } = useTranslation();
  const busy = props.status === "uploading" || props.status === "running";
  const runDisabled = asrRunDisabled(props);
  const status = statusLine(t, props.status, props.progress);
  const percent = props.wer === null ? null : (props.wer * 100).toFixed(1);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t("ai.asr.intro")}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          data-testid="ai.asr.loadDemo"
          disabled={props.demoLoading || busy}
          onClick={props.onLoadDemo}
        >
          {props.demoLoading ? t("ai.asr.demoLoading") : t("ai.asr.loadDemo")}
        </Button>
        {props.modelId !== undefined ? (
          <span className="text-xs text-muted" dir="ltr">
            {t("ai.asr.model", { modelId: props.modelId })}
          </span>
        ) : null}
      </div>

      {props.modelState === "missing" ? (
        <p data-testid="ai.asr.modelMissing" className="text-sm text-muted">
          {t("ai.asr.modelMissing")}
        </p>
      ) : null}

      {!props.hasSource ? (
        <>
          <p className="text-sm text-muted">{t("ai.asr.noSource")}</p>
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
          data-testid="ai.asr.progress"
          className="h-2 w-full"
          max={1}
          value={props.progress}
        />
      ) : null}
      <p data-testid="ai.status" aria-live="polite" className="text-sm">
        {status}
      </p>
      {props.errorKey !== null ? (
        <p data-testid="ai.asr.error" className="text-sm text-red-400">
          {t(props.errorKey)}
        </p>
      ) : null}
      {props.demoErrorKey !== null ? (
        <p data-testid="ai.asr.demoError" className="text-sm text-red-400">
          {t(props.demoErrorKey)}
        </p>
      ) : null}

      {props.transcript !== null ? (
        <div className="flex flex-col gap-2 rounded-md border border-surface p-3">
          <h3 className="text-sm font-medium">{t("ai.asr.transcript")}</h3>
          <p data-testid="ai.asr.transcript" className="text-sm">
            {props.transcript}
          </p>
          {props.language !== null ? (
            <p className="text-xs text-muted">
              {t("ai.asr.language", { language: props.language })}
            </p>
          ) : null}
          {props.segments.length > 0 ? (
            <div className="flex flex-col gap-1">
              <h4 className="text-xs font-medium">{t("ai.asr.segments")}</h4>
              <ol className="flex flex-col gap-1">
                {props.segments.map((segment, index) => (
                  <li
                    key={`${String(index)}-${String(segment.startS)}`}
                    data-testid={`ai.asr.segment.${String(index)}`}
                    className="flex flex-wrap gap-2 text-xs"
                  >
                    <span dir="ltr" className="text-muted">
                      {t("ai.asr.segmentRange", {
                        start: segment.startS.toFixed(2),
                        end: segment.endS.toFixed(2),
                      })}
                    </span>
                    <span>{segment.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}

      {props.referenceStatus === "loading" ? (
        <p data-testid="ai.asr.referenceLoading" className="text-sm text-muted">
          {t("ai.asr.referenceLoading")}
        </p>
      ) : null}
      {props.referenceStatus === "missing" ? (
        <p data-testid="ai.asr.referenceMissing" className="text-sm text-muted">
          {t("ai.asr.referenceMissing")}
        </p>
      ) : null}
      {props.referenceStatus === "empty" ? (
        <p data-testid="ai.asr.referenceEmpty" className="text-sm text-muted">
          {t("ai.asr.referenceEmpty")}
        </p>
      ) : null}
      {props.referenceStatus === "ready" && props.referenceText !== null ? (
        <details className="rounded-md border border-surface p-3">
          <summary className="text-sm font-medium">{t("ai.asr.reference")}</summary>
          <p className="mt-2 text-xs text-muted">{props.referenceText}</p>
        </details>
      ) : null}
      {props.wer !== null && percent !== null ? (
        <div className="flex flex-col gap-1">
          <p data-testid="ai.asr.wer" dir="ltr" className="text-sm font-medium">
            {t("ai.asr.wer", { percent })}
          </p>
          <p className="text-xs text-muted">{t("ai.asr.werHint")}</p>
        </div>
      ) : null}

      <p className="text-sm text-muted">
        {t("ai.asr.compressedHint")}{" "}
        <a className="underline" href="/tools/codec-lab">
          {t("ai.asr.openCodecLab")}
        </a>
      </p>

      <p className="text-xs text-muted">{t("ai.caption.approximation")}</p>
    </div>
  );
}

export function AsrTab({
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
  const [reference, setReference] = useState<{
    readonly status: ReferenceStatus;
    readonly text: string | null;
  }>({ status: "idle", text: null });

  useEffect(() => {
    if (original === null || !usesReferenceTranscript(original)) {
      setReference({ status: "idle", text: null });
      return;
    }
    let cancelled = false;
    setReference({ status: "loading", text: null });
    void fetchReferenceTranscript().then(
      (text) => {
        if (!cancelled) {
          setReference(text.trim() === "" ? { status: "empty", text } : { status: "ready", text });
        }
      },
      () => {
        if (!cancelled) {
          setReference({ status: "missing", text: null });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [original]);

  const info = result === null ? null : readAsrResult(result);
  const excerptSeconds =
    original === null
      ? AI_MAX_EXCERPT_SECONDS
      : Math.min(AI_MAX_EXCERPT_SECONDS, original.samples.length / original.sampleRateHz);
  let wer: number | null = null;
  if (info !== null && reference.status === "ready" && reference.text !== null) {
    try {
      wer = wordErrorRate(reference.text, info.text);
    } catch {
      wer = null;
    }
  }

  function handleRun(): void {
    if (
      original === null ||
      asrRunDisabled({ backendOnline, modelState: model?.state, hasSource: true, status })
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
    void run("asr", excerpt, { language: null });
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

  return (
    <AsrView
      backendOnline={backendOnline}
      modelState={model?.state}
      modelId={info?.modelId ?? model?.model_id}
      hasSource={original !== null}
      transcript={info?.text ?? null}
      segments={info?.segments ?? []}
      language={info?.language ?? null}
      referenceStatus={reference.status}
      referenceText={reference.text}
      wer={wer}
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
