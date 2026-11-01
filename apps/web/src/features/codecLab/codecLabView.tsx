/**
 * F04 browser compression lab (Wave-4 Plan 01 Task 3).
 *
 * Encode is explicit: the user picks a codec and an excerpt, presses Encode,
 * and the store runs `codecLabProcess` on that exact slice (R23). The result
 * persists until the next encode, so changing a setting only raises the
 * translated stale hint. All numbers are Latin/dir="ltr" (AGENTS §6).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";

import { Button } from "../../components/ui/button";
import { formatS } from "../../lib/format";
import type { CodecLabCodec, CodecLabMeta, CodecLabResult } from "../../session/ops";
import { useSessionStore } from "../../session/store";
import { UploadEmptyState } from "../input/upload";
import {
  CODEC_LAB_CODECS,
  CODEC_LAB_MDCT_KBPS,
  type CodecLabSettings,
  codecLabRangeFromSelection,
  codecLabSettingsFromSearch,
  codecLabSettingsToSearch,
  isCodecLabStale,
} from "./codecLabState";

const CONTROL_FOCUS_CLASSES =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const INPUT_CLASSES = `rounded border border-surface bg-bg px-2 py-1 text-sm ${CONTROL_FOCUS_CLASSES}`;
const HISTOGRAM_HEIGHT_PX = 96;
const MAX_DEVICE_PIXEL_RATIO = 2;

type CodecLabViewResult = {
  readonly meta: CodecLabMeta;
  readonly samples: Float32Array;
  readonly settings: CodecLabSettings;
};

type CodecLabStatus = "idle" | "running" | "ready" | "error";
type CodecLabErrorKey = "codecLab.error.failed" | "codecLab.error.playback";

function unpackResult(outcome: CodecLabResult): Float32Array | null {
  if (outcome.payload === undefined) {
    return null;
  }
  return new Float32Array(
    outcome.payload.buffer,
    outcome.payload.byteOffset,
    outcome.payload.byteLength / 4,
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) {
    return "—";
  }
  if (Math.abs(bytes) < 1024) {
    return `${bytes.toFixed(0)} B`;
  }
  if (Math.abs(bytes) < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function formatNumber(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "∞";
}

function Histogram({
  histogram,
  ariaLabel,
}: {
  readonly histogram: readonly number[];
  readonly ariaLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DEVICE_PIXEL_RATIO);
    const widthDevicePx = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const heightDevicePx = Math.max(1, Math.round(HISTOGRAM_HEIGHT_PX * dpr));
    canvas.width = widthDevicePx;
    canvas.height = heightDevicePx;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }
    ctx.clearRect(0, 0, widthDevicePx, heightDevicePx);
    const max = Math.max(1, ...histogram);
    const barWidth = widthDevicePx / Math.max(1, histogram.length);
    ctx.fillStyle = "#8bd3c7";
    for (let index = 0; index < histogram.length; index += 1) {
      const count = histogram[index] ?? 0;
      const height = (count / max) * heightDevicePx;
      if (height > 0) {
        ctx.fillRect(index * barWidth, heightDevicePx - height, Math.max(1, barWidth), height);
      }
    }
  }, [histogram]);
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={ariaLabel}
      data-testid="codecLab.histogram"
      dir="ltr"
      style={{ height: `${HISTOGRAM_HEIGHT_PX}px` }}
      className="block w-full rounded bg-bg ring-1 ring-surface"
    />
  );
}

function StatRow({
  label,
  value,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly testId: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-surface/60 py-1">
      <dt>{label}</dt>
      <dd dir="ltr" data-testid={testId} className="tabular-nums">
        {value}
      </dd>
    </div>
  );
}

export function CodecLabView(): React.ReactElement {
  const { t } = useTranslation();
  const original = useSessionStore((state) => state.original);
  const selection = useSessionStore((state) => state.selection);
  const [searchParams, setSearchParams] = useSearchParams();
  const settings = useMemo(
    () =>
      codecLabSettingsFromSearch(
        `?${searchParams.toString()}`,
        {
          sampleCount: original?.samples.length ?? 0,
          sampleRateHz: original?.sampleRateHz ?? 1,
        },
        selection,
      ),
    [searchParams, original, selection],
  );
  const [status, setStatus] = useState<CodecLabStatus>("idle");
  const [result, setResult] = useState<CodecLabViewResult | null>(null);
  const [errorKey, setErrorKey] = useState<CodecLabErrorKey | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    runIdRef.current += 1;
    setStatus("idle");
    setResult(null);
    setErrorKey(null);
    if (original === null) {
      return;
    }
  }, [original]);

  function updateSettings(patch: Partial<CodecLabSettings>): void {
    const next = { ...settings, ...patch };
    const params = new URLSearchParams(searchParams);
    for (const [key, entry] of new URLSearchParams(codecLabSettingsToSearch(next))) {
      params.set(key, entry);
    }
    setSearchParams(params, { replace: true });
  }

  function updateRange(startSample: number, endSample: number): void {
    const sampleCount = original?.samples.length ?? 0;
    const sampleRateHz = original?.sampleRateHz ?? 1;
    const range = codecLabRangeFromSelection({ startSample, endSample }, sampleCount, sampleRateHz);
    updateSettings(range);
  }

  const sampleRateHz = original?.sampleRateHz ?? 1;
  const sampleCount = original?.samples.length ?? 0;
  const rangeEmpty = settings.endSample <= settings.startSample;

  function run(): void {
    if (original === null || rangeEmpty || status === "running") {
      return;
    }
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const runSettings = settings;
    setStatus("running");
    setErrorKey(null);
    const ticket = useSessionStore.getState().deriveWithSourceSlice(
      "codecLabProcess",
      {
        codec: runSettings.codec,
        sampleRateHz: original.sampleRateHz,
        startSample: runSettings.startSample,
        endSample: runSettings.endSample,
        mdctBitsPerSecond: runSettings.mdctBitsPerSecond,
      },
      runSettings.startSample,
      runSettings.endSample,
    );
    ticket.outcome.then(
      (outcome) => {
        if (runIdRef.current !== runId || "cancelled" in outcome) {
          return;
        }
        const samples = unpackResult(outcome);
        if (samples === null) {
          setStatus("error");
          setErrorKey("codecLab.error.failed");
          return;
        }
        setResult({ meta: outcome.meta, samples, settings: runSettings });
        setStatus("ready");
      },
      () => {
        if (runIdRef.current === runId) {
          setStatus("error");
          setErrorKey("codecLab.error.failed");
        }
      },
    );
  }

  function playResult(): void {
    if (result === null) {
      return;
    }
    const installed = useSessionStore
      .getState()
      .setProcessed(result.samples.slice(), result.meta.sampleRateHz, "codecLab");
    if (!installed.ok) {
      setErrorKey("codecLab.error.playback");
    }
  }

  const codecLabels: Record<CodecLabCodec, string> = {
    rle: t("codecLab.codec.rle"),
    huffman: t("codecLab.codec.huffman"),
    deltaHuffman: t("codecLab.codec.deltaHuffman"),
    mulaw: t("codecLab.codec.mulaw"),
    alaw: t("codecLab.codec.alaw"),
    mdct: t("codecLab.codec.mdct"),
  };

  if (original === null) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">{t("tool.codecLab.title")}</h2>
        <UploadEmptyState />
      </section>
    );
  }

  const stale = result !== null && isCodecLabStale(settings, result.settings);
  const codeLengths = result?.meta.codeLengths ?? [];
  const nonZeroCodeLengths = codeLengths
    .map((length, symbol) => ({ length, symbol }))
    .filter((entry) => entry.length > 0);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold">{t("tool.codecLab.title")}</h2>

      <div className="grid grid-cols-1 gap-3 rounded border border-surface p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("codecLab.excerpt.start")}</span>
          <input
            type="number"
            min={0}
            step={0.01}
            dir="ltr"
            value={(settings.startSample / sampleRateHz).toFixed(3)}
            data-testid="codecLab.control.start"
            onChange={(event) => {
              const seconds = Number(event.currentTarget.value);
              if (Number.isFinite(seconds)) {
                updateRange(Math.round(seconds * sampleRateHz), settings.endSample);
              }
            }}
            className={INPUT_CLASSES}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("codecLab.excerpt.end")}</span>
          <input
            type="number"
            min={0}
            step={0.01}
            dir="ltr"
            value={(settings.endSample / sampleRateHz).toFixed(3)}
            data-testid="codecLab.control.end"
            onChange={(event) => {
              const seconds = Number(event.currentTarget.value);
              if (Number.isFinite(seconds)) {
                updateRange(settings.startSample, Math.round(seconds * sampleRateHz));
              }
            }}
            className={INPUT_CLASSES}
          />
        </label>
        <div className="flex items-end">
          <Button
            size="sm"
            variant="outline"
            data-testid="codecLab.useSelection"
            onClick={() => {
              updateSettings(codecLabRangeFromSelection(selection, sampleCount, sampleRateHz));
            }}
          >
            {t("codecLab.excerpt.useSelection")}
          </Button>
        </div>
        <p data-testid="codecLab.range" dir="ltr" className="self-end text-xs text-muted">
          {t("codecLab.excerpt.range", {
            start: formatS(settings.startSample / sampleRateHz),
            end: formatS(settings.endSample / sampleRateHz),
          })}
        </p>
        <p className="text-xs text-muted sm:col-span-2 lg:col-span-4">
          {t("codecLab.excerpt.capNotice")}
        </p>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("codecLab.codec.label")}</span>
          <select
            value={settings.codec}
            data-testid="codecLab.control.codec"
            onChange={(event) => {
              const next = event.currentTarget.value;
              if ((CODEC_LAB_CODECS as readonly string[]).includes(next)) {
                updateSettings({ codec: next as CodecLabCodec });
              }
            }}
            className={INPUT_CLASSES}
          >
            {CODEC_LAB_CODECS.map((codec) => (
              <option key={codec} value={codec}>
                {codecLabels[codec]}
              </option>
            ))}
          </select>
        </label>
        {settings.codec === "mdct" ? (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">{t("codecLab.bitrate.label")}</span>
            <select
              value={settings.mdctBitsPerSecond / 1000}
              data-testid="codecLab.control.bitrate"
              onChange={(event) => {
                const kbps = Number(event.currentTarget.value);
                if (Number.isFinite(kbps)) {
                  updateSettings({ mdctBitsPerSecond: kbps * 1000 });
                }
              }}
              className={INPUT_CLASSES}
            >
              {CODEC_LAB_MDCT_KBPS.map((kbps) => (
                <option key={kbps} value={kbps}>
                  {t("codecLab.bitrate.option", { kbps })}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          data-testid="codecLab.encode"
          disabled={status === "running" || rangeEmpty}
          onClick={run}
        >
          {status === "running" ? t("codecLab.running") : t("codecLab.encode")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          data-testid="codecLab.play"
          disabled={result === null}
          onClick={playResult}
        >
          {t("codecLab.play")}
        </Button>
        {stale ? (
          <p data-testid="codecLab.stale" role="status" className="text-sm text-accent">
            {t("codecLab.stale")}
          </p>
        ) : null}
      </div>

      {errorKey !== null ? (
        <p data-testid="codecLab.error" role="alert" className="text-sm text-danger">
          {errorKey === "codecLab.error.failed"
            ? t("codecLab.error.failed")
            : t("codecLab.error.playback")}
        </p>
      ) : status === "idle" ? (
        <p className="text-sm text-muted">{t("codecLab.status.idle")}</p>
      ) : null}

      {result !== null ? (
        <>
          <div className="rounded border border-surface p-3">
            <h3 className="mb-2 text-sm font-semibold">{t("codecLab.stats.title")}</h3>
            <dl className="grid grid-cols-1 gap-x-6 text-xs sm:grid-cols-2">
              <StatRow
                label={t("codecLab.stats.originalBytes")}
                value={formatBytes(result.meta.originalBytes)}
                testId="codecLab.stat.originalBytes"
              />
              <StatRow
                label={t("codecLab.stats.compressedBytes")}
                value={formatBytes(result.meta.compressedSizeBytes)}
                testId="codecLab.stat.compressedBytes"
              />
              <StatRow
                label={t("codecLab.stats.ratio")}
                value={`${formatNumber(result.meta.compressionRatio)}×`}
                testId="codecLab.stat.ratio"
              />
              <StatRow
                label={t("codecLab.stats.bitsPerSample")}
                value={formatNumber(result.meta.bitsPerSample)}
                testId="codecLab.stat.bitsPerSample"
              />
              <StatRow
                label={t("codecLab.stats.bitrate")}
                value={`${formatNumber(result.meta.bitrateKbps)} kbps`}
                testId="codecLab.stat.bitrate"
              />
              <StatRow
                label={t("codecLab.stats.entropy")}
                value={`${formatNumber(result.meta.entropyBitsPerSymbol)} bit/symbol`}
                testId="codecLab.stat.entropy"
              />
              <StatRow
                label={t("codecLab.stats.encodeMs")}
                value={`${formatNumber(result.meta.encodeMs)} ms`}
                testId="codecLab.stat.encodeMs"
              />
              <StatRow
                label={t("codecLab.stats.decodeMs")}
                value={`${formatNumber(result.meta.decodeMs)} ms`}
                testId="codecLab.stat.decodeMs"
              />
              <StatRow
                label={t("codecLab.stats.bitExact")}
                value={result.meta.bitExact ? t("codecLab.stats.yes") : t("codecLab.stats.no")}
                testId="codecLab.stat.bitExact"
              />
              <StatRow
                label={t("codecLab.stats.snr")}
                value={`${formatNumber(result.meta.snrDb)} dB`}
                testId="codecLab.stat.snr"
              />
              <StatRow
                label={t("codecLab.stats.segmentalSnr")}
                value={`${formatNumber(result.meta.segmentalSnrDb)} dB`}
                testId="codecLab.stat.segmentalSnr"
              />
              <StatRow
                label={t("codecLab.stats.psnr")}
                value={`${formatNumber(result.meta.psnrDb)} dB`}
                testId="codecLab.stat.psnr"
              />
              <StatRow
                label={t("codecLab.stats.mse")}
                value={formatNumber(result.meta.mse, 6)}
                testId="codecLab.stat.mse"
              />
            </dl>
            <p className="mt-2 text-xs text-muted">{t("codecLab.stats.psnrNote")}</p>
          </div>

          {result.meta.frameCount !== null ? (
            <div className="rounded border border-surface p-3 text-xs">
              <h3 className="mb-2 text-sm font-semibold">{t("codecLab.mdct.title")}</h3>
              <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-3">
                <StatRow
                  label={t("codecLab.mdct.sparsity")}
                  value={`${formatNumber((result.meta.coefficientSparsity ?? 0) * 100)}%`}
                  testId="codecLab.mdct.sparsity"
                />
                <StatRow
                  label={t("codecLab.mdct.frames")}
                  value={String(result.meta.frameCount)}
                  testId="codecLab.mdct.frames"
                />
                <StatRow
                  label={t("codecLab.mdct.totalBits")}
                  value={String(result.meta.bitsTotal ?? 0)}
                  testId="codecLab.mdct.totalBits"
                />
              </dl>
            </div>
          ) : null}

          <figure className="flex flex-col gap-1 rounded border border-surface p-3">
            <figcaption className="text-sm font-semibold">
              {t("codecLab.histogram.title")}
            </figcaption>
            <Histogram histogram={result.meta.histogram} ariaLabel={t("codecLab.histogram.aria")} />
          </figure>

          {nonZeroCodeLengths.length > 0 ? (
            <div className="rounded border border-surface p-3">
              <h3 className="mb-2 text-sm font-semibold">{t("codecLab.codeLengths.title")}</h3>
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-bg text-muted">
                    <tr>
                      <th className="text-start font-medium">{t("codecLab.codeLengths.symbol")}</th>
                      <th className="text-end font-medium">{t("codecLab.codeLengths.length")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nonZeroCodeLengths.map((entry) => (
                      <tr key={entry.symbol}>
                        <td dir="ltr" className="font-mono">
                          0x{entry.symbol.toString(16).padStart(2, "0").toUpperCase()}
                        </td>
                        <td dir="ltr" className="text-end tabular-nums">
                          {entry.length}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <details className="rounded border border-surface p-3 text-sm">
        <summary className="cursor-pointer font-semibold">{t("codecLab.theory.title")}</summary>
        <div className="mt-2 flex flex-col gap-2 text-xs text-muted">
          <p>{t("codecLab.theory.rle")}</p>
          <p>{t("codecLab.theory.huffman")}</p>
          <p>{t("codecLab.theory.delta")}</p>
          <p>{t("codecLab.theory.companding")}</p>
          <p>{t("codecLab.theory.mdct")}</p>
          <div>
            <h4 className="font-semibold text-text">{t("codecLab.theory.observe.title")}</h4>
            <ul className="ms-4 list-disc">
              <li>{t("codecLab.theory.observe.lossless")}</li>
              <li>{t("codecLab.theory.observe.entropy")}</li>
              <li>{t("codecLab.theory.observe.bitrate")}</li>
              <li>{t("codecLab.theory.observe.sparsity")}</li>
            </ul>
          </div>
        </div>
      </details>
    </section>
  );
}
