/**
 * Waveform canvas glue (F02): owns the canvas element's DPR-aware size and
 * repaints the cached min/max envelope. It subscribes to the ONE playhead
 * source (`appPlayhead`); playback therefore repaints this canvas without a
 * React re-render, and the pub-sub's rAF loop stays owned by `usePlayer`.
 */
import { type RefObject, useEffect, useRef, useState } from "react";

import { useSessionStore } from "../../session/store";
import { appPlayhead } from "../player/playhead";
import { paintWaveform, type SampleRange, type WaveformPaintOptions } from "./paintWaveform";

type WaveformCanvasProps = {
  readonly minMax: Float32Array;
  readonly sampleRange: SampleRange;
  readonly selectionRange: SampleRange;
  readonly viewportRange?: SampleRange;
  readonly verticalScale?: number;
  readonly heightPx: number;
  readonly testId: string;
  readonly label: string;
  readonly interactive?: boolean;
  readonly canvasRef?: RefObject<HTMLCanvasElement | null>;
  readonly onPointerDown?: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerMove?: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerUp?: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
};

function cssColor(element: HTMLElement, variable: string, fallback: string): string {
  const value = getComputedStyle(element).getPropertyValue(variable).trim();
  return value === "" ? fallback : value;
}

function palette(
  element: HTMLElement,
): Omit<
  WaveformPaintOptions,
  | "widthPx"
  | "heightPx"
  | "dpr"
  | "sampleRange"
  | "playheadSample"
  | "selectionRange"
  | "viewportRange"
  | "verticalScale"
> {
  return {
    background: cssColor(element, "--color-bg", "#0b1016"),
    wave: cssColor(element, "--color-accent", "#59d8e6"),
    center: cssColor(element, "--color-surface", "#25303a"),
    playhead: cssColor(element, "--color-text", "#f1eee4"),
    selection: "rgba(89, 216, 230, 0.28)",
    selectionBorder: cssColor(element, "--color-text", "#f1eee4"),
  };
}

export function WaveformCanvas(props: WaveformCanvasProps) {
  const localRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = props.canvasRef ?? localRef;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [widthPx, setWidthPx] = useState(640);
  // This canvas plots original-source samples; the playhead publishes the
  // ACTIVE lane's samples, so map back through time when a processed lane is
  // playing at another rate.
  const originalRateHz = useSessionStore((state) => state.original?.sampleRateHz ?? 0);
  const activeRateHz = useSessionStore(
    (state) =>
      (state.playbackMode === "processed"
        ? state.processed?.sampleRateHz
        : state.original?.sampleRateHz) ?? 0,
  );

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
    if (canvas === null) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }
    let playheadSample = Number.NaN;
    const draw = (): void => {
      paintWaveform(ctx, props.minMax, {
        ...palette(canvas),
        widthPx,
        heightPx: props.heightPx,
        dpr: window.devicePixelRatio || 1,
        sampleRange: props.sampleRange,
        selectionRange: props.selectionRange,
        viewportRange: props.viewportRange,
        verticalScale: props.verticalScale,
        playheadSample,
      });
    };
    draw();
    const unsubscribe = appPlayhead.subscribe((sample) => {
      playheadSample =
        originalRateHz > 0 && activeRateHz > 0 ? (sample * originalRateHz) / activeRateHz : sample;
      draw();
    });
    return unsubscribe;
  }, [
    canvasRef,
    props.minMax,
    props.sampleRange,
    props.selectionRange,
    props.viewportRange,
    props.verticalScale,
    props.heightPx,
    widthPx,
    originalRateHz,
    activeRateHz,
  ]);

  const canvasClass =
    "block w-full rounded-md border border-surface " +
    (props.interactive === true ? "cursor-crosshair" : "");

  if (props.interactive === true) {
    return (
      <div ref={hostRef} className="w-full">
        <div
          role="slider"
          aria-label={props.label}
          aria-valuemin={0}
          aria-valuemax={props.sampleRange.endSample}
          aria-valuenow={props.selectionRange.startSample}
          tabIndex={0}
          className="rounded-md outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onPointerDown={props.onPointerDown}
          onPointerMove={props.onPointerMove}
          onPointerUp={props.onPointerUp}
          onKeyDown={props.onKeyDown}
        >
          <canvas
            ref={canvasRef}
            data-testid={props.testId}
            role="img"
            aria-label={props.label}
            className={canvasClass}
            style={{ height: `${props.heightPx}px` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={hostRef} className="w-full">
      <canvas
        ref={canvasRef}
        data-testid={props.testId}
        role="img"
        aria-label={props.label}
        className={canvasClass}
        style={{ height: `${props.heightPx}px` }}
      />
    </div>
  );
}
