/**
 * Waveform tool (F02): overview + detail panels painted from the worker's
 * min/max envelope. The page is a thin reader of the session store's derived
 * cache; all DSP happens in the worker through `deriveWithSource`.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatS } from "../../lib/format";
import type { WaveformOverviewResult } from "../../session/ops";
import { useSessionStore } from "../../session/store";
import { UploadEmptyState } from "../input/upload";
import { WaveformCanvas } from "./canvasWaveform";

const OVERVIEW_BUCKET_COUNT = 1200;

function useOverview(): {
  readonly minMax: Float32Array;
  readonly sampleCount: number;
} {
  const original = useSessionStore((state) => state.original);
  const derived = useSessionStore((state) => state.derived);
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    if (original === null) {
      setKey(null);
      return;
    }
    const ticket = useSessionStore.getState().deriveWithSource("waveformOverview", {
      bucketCount: OVERVIEW_BUCKET_COUNT,
      sampleRateHz: original.sampleRateHz,
    });
    setKey(ticket.key);
    ticket.outcome.catch(() => undefined);
  }, [original]);

  const entry = key === null ? undefined : derived.get(key);
  return useMemo(() => {
    const result = entry?.result as WaveformOverviewResult | undefined;
    const payload = result?.payload;
    if (result === undefined || payload === undefined) {
      return { minMax: new Float32Array(0), sampleCount: original?.samples.length ?? 0 };
    }
    return {
      minMax: new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4),
      sampleCount: result.meta.sampleCount,
    };
  }, [entry, original]);
}

export function WaveformView() {
  const { t } = useTranslation();
  const original = useSessionStore((state) => state.original);
  const selection = useSessionStore((state) => state.selection);
  const { minMax, sampleCount } = useOverview();

  if (original === null) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">{t("tool.waveform.title")}</h2>
        <UploadEmptyState />
      </section>
    );
  }

  const durationSeconds = sampleCount / original.sampleRateHz;
  let peak = 0;
  for (const value of minMax) {
    peak = Math.max(peak, Math.abs(value));
  }
  const sampleRange = { startSample: 0, endSample: sampleCount };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl font-semibold">{t("tool.waveform.title")}</h2>
        <p dir="ltr" className="font-mono text-xs text-muted">
          {t("waveform.readout", {
            duration: formatS(durationSeconds),
            rateHz: original.sampleRateHz,
            peak: peak.toFixed(3),
          })}
        </p>
      </div>

      <figure className="flex flex-col gap-1">
        <figcaption className="flex items-baseline justify-between gap-2 text-sm text-muted">
          <span>{t("waveform.overview")}</span>
          <span dir="ltr" className="font-mono text-xs">
            {formatS(0)} – {formatS(durationSeconds)}
          </span>
        </figcaption>
        <WaveformCanvas
          minMax={minMax}
          sampleRange={sampleRange}
          selectionRange={selection}
          heightPx={120}
          testId="waveform.overview.canvas"
          label={t("waveform.overviewAria")}
        />
      </figure>

      <figure className="flex flex-col gap-1">
        <figcaption className="flex items-baseline justify-between gap-2 text-sm text-muted">
          <span>{t("waveform.detail")}</span>
          <span dir="ltr" className="font-mono text-xs">
            {formatS(selection.startSample / original.sampleRateHz)} –{" "}
            {formatS(selection.endSample / original.sampleRateHz)}
          </span>
        </figcaption>
        <WaveformCanvas
          minMax={minMax}
          sampleRange={sampleRange}
          selectionRange={selection}
          heightPx={220}
          testId="waveform.detail.canvas"
          label={t("waveform.detailAria")}
        />
      </figure>
    </section>
  );
}
