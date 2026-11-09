/**
 * A/B compare slot (F02, Wave 2 Plan 03 Task 4; processed pane in Wave 3
 * Plan 01 Task 5; original pane in the Wave 4 hotfix). Both panes render the
 * worker's `waveformOverview` op: the original reuses the waveform view's
 * 1200-bucket cache entry, and the processed lane uses its own 200-bucket
 * standalone key because it is not a session source.
 *
 * R23: every derivation goes through the session store, never the rpc module.
 * Payloads are COPIES; the transfer neuters only the copy, so playback keeps
 * the store-owned buffers intact.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { WaveformOverviewResult } from "../../session/ops";
import { useSessionStore } from "../../session/store";
import { paintWaveform } from "./paintWaveform";

const COMPARE_BUCKETS = 200;
const ORIGINAL_BUCKETS = 1200;
const COMPARE_HEIGHT_PX = 64;

function ComparePane({ label, testId }: { readonly label: string; readonly testId: string }) {
  return (
    <figure className="flex flex-col gap-1">
      <div
        data-testid={testId}
        aria-hidden="true"
        className="flex h-16 items-center justify-center rounded border border-dashed border-surface text-xl text-muted"
      >
        —
      </div>
      <figcaption className="text-xs text-muted">{label}</figcaption>
    </figure>
  );
}

function useOriginalMinMax(): Float32Array | null {
  const original = useSessionStore((state) => state.original);
  const derived = useSessionStore((state) => state.derived);
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    if (original === null) {
      setKey(null);
      return;
    }
    const ticket = useSessionStore.getState().deriveWithSource("waveformOverview", {
      bucketCount: ORIGINAL_BUCKETS,
      sampleRateHz: original.sampleRateHz,
    });
    setKey(ticket.key);
    ticket.outcome.catch(() => undefined);
  }, [original]);

  const entry = key === null ? undefined : derived.get(key);
  const result = entry?.result as WaveformOverviewResult | undefined;
  const payload = result?.payload;
  if (payload === undefined) {
    return null;
  }
  return new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
}

function useProcessedMinMax(): Float32Array | null {
  const processed = useSessionStore((state) => state.processed);
  const [minMax, setMinMax] = useState<Float32Array | null>(null);

  useEffect(() => {
    if (processed === null) {
      setMinMax(null);
      return;
    }
    let cancelled = false;
    const copy = processed.samples.slice();
    const ticket = useSessionStore
      .getState()
      .deriveStandalone(
        "waveformOverview",
        { bucketCount: COMPARE_BUCKETS, sampleRateHz: processed.sampleRateHz },
        { buffer: copy.buffer, byteOffset: 0, byteLength: copy.byteLength },
      );
    ticket.outcome.then(
      (outcome) => {
        if (cancelled || "cancelled" in outcome) {
          return;
        }
        const payload = outcome.payload;
        setMinMax(
          payload === undefined
            ? null
            : new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4),
        );
      },
      () => {
        if (!cancelled) {
          setMinMax(null);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [processed]);

  return minMax;
}

function WaveformComparePane({
  label,
  testId,
  minMax,
}: {
  readonly label: string;
  readonly testId: string;
  readonly minMax: Float32Array | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [widthPx, setWidthPx] = useState(640);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        setWidthPx(Math.max(1, Math.round(entry.contentRect.width)));
      }
    });
    observer.observe(host);
    setWidthPx(Math.max(1, Math.round(host.getBoundingClientRect().width)));
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || minMax === null) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }
    paintWaveform(ctx, minMax, {
      widthPx,
      heightPx: COMPARE_HEIGHT_PX,
      dpr: window.devicePixelRatio || 1,
      background: "#0b1016",
      wave: "#59d8e6",
      center: "#25303a",
      playhead: "#f1eee4",
      selection: "rgba(89, 216, 230, 0.18)",
    });
  }, [minMax, widthPx]);

  if (minMax === null) {
    return <ComparePane label={label} testId={testId} />;
  }
  return (
    <figure className="flex flex-col gap-1">
      <div ref={hostRef} dir="ltr">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label}
          data-testid={testId}
          style={{ height: `${COMPARE_HEIGHT_PX}px` }}
          className="block w-full rounded border border-surface bg-bg"
        />
      </div>
      <figcaption className="text-xs text-muted">{label}</figcaption>
    </figure>
  );
}

export function CompareSlot() {
  const { t } = useTranslation();
  const original = useSessionStore((state) => state.original);
  const processed = useSessionStore((state) => state.processed);
  const originalMinMax = useOriginalMinMax();
  const processedMinMax = useProcessedMinMax();
  if (original === null) {
    return null;
  }
  return (
    <section data-testid="compare.slot" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t("compare.title")}</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <WaveformComparePane
          label={t("compare.original")}
          testId="compare.original.slot"
          minMax={originalMinMax}
        />
        <WaveformComparePane
          label={t("compare.derived")}
          testId="compare.derived.slot"
          minMax={processedMinMax}
        />
      </div>
      {processed === null && (
        <p data-testid="compare.pending" className="text-xs text-muted">
          {t("compare.pending")}
        </p>
      )}
    </section>
  );
}
