/**
 * A/B compare slot (F02, Wave 2 Plan 03 Task 4; processed pane in Wave 3
 * Plan 01 Task 5). The right pane renders the current processed lane through
 * the worker's `waveformOverview` op (bucket count 200); the left pane keeps
 * its honest dash until a later plan gives the original its own readout.
 *
 * R23: the derivation goes through the session store, never the rpc module.
 * The payload is a COPY of `processed.samples`; the transfer neuters only
 * that copy, so playback keeps the store-owned buffer intact.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSessionStore } from "../../session/store";
import { paintWaveform } from "./paintWaveform";

const COMPARE_BUCKETS = 200;
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

function ProcessedComparePane({ label }: { readonly label: string }) {
  const processed = useSessionStore((state) => state.processed);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [minMax, setMinMax] = useState<Float32Array | null>(null);
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

  if (processed === null) {
    return <ComparePane label={label} testId="compare.derived.slot" />;
  }
  return (
    <figure className="flex flex-col gap-1">
      <div ref={hostRef} dir="ltr">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label}
          data-testid="compare.derived.slot"
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
  if (original === null) {
    return null;
  }
  return (
    <section data-testid="compare.slot" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t("compare.title")}</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ComparePane label={t("compare.original")} testId="compare.original.slot" />
        <ProcessedComparePane label={t("compare.derived")} />
      </div>
      {processed === null && (
        <p data-testid="compare.pending" className="text-xs text-muted">
          {t("compare.pending")}
        </p>
      )}
    </section>
  );
}
