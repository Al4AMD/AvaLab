/**
 * Waveform canvas glue (F02): owns the canvas element's DPR-aware size and
 * repaints the cached min/max envelope. It subscribes to the ONE playhead
 * source (`appPlayhead`); playback therefore repaints this canvas without a
 * React re-render, and the pub-sub's rAF loop stays owned by `usePlayer`.
 */
import { type RefObject, useEffect, useRef, useState } from "react";

import { appPlayhead } from "../player/playhead";
import { paintWaveform, type SampleRange, type WaveformPaintOptions } from "./paintWaveform";

type WaveformCanvasProps = {
  readonly minMax: Float32Array;
  readonly sampleRange: SampleRange;
  readonly selectionRange: SampleRange;
  readonly heightPx: number;
  readonly testId: string;
  readonly label: string;
  readonly interactive?: boolean;
  readonly canvasRef?: RefObject<HTMLCanvasElement | null>;
  readonly onPointerDown?: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  readonly onPointerMove?: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  readonly onPointerUp?: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  readonly onKeyDown?: (event: React.KeyboardEvent<HTMLCanvasElement>) => void;
};

function cssColor(element: HTMLElement, variable: string, fallback: string): string {
  const value = getComputedStyle(element).getPropertyValue(variable).trim();
  return value === "" ? fallback : value;
}

function palette(
  element: HTMLElement,
): Omit<
  WaveformPaintOptions,
  "widthPx" | "heightPx" | "dpr" | "sampleRange" | "playheadSample" | "selectionRange"
> {
  return {
    background: cssColor(element, "--color-bg", "#0b1016"),
    wave: cssColor(element, "--color-accent", "#59d8e6"),
    center: cssColor(element, "--color-surface", "#25303a"),
    playhead: cssColor(element, "--color-text", "#f1eee4"),
    selection: "rgba(89, 216, 230, 0.18)",
  };
}

export function WaveformCanvas(props: WaveformCanvasProps) {
  const localRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = props.canvasRef ?? localRef;
  const hostRef = useRef<HTMLDivElement | null>(null);
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
        playheadSample,
      });
    };
    draw();
    const unsubscribe = appPlayhead.subscribe((sample) => {
      playheadSample = sample;
      draw();
    });
    return unsubscribe;
  }, [canvasRef, props.minMax, props.sampleRange, props.selectionRange, props.heightPx, widthPx]);

  return (
    <div ref={hostRef} className="w-full">
      <canvas
        ref={canvasRef}
        data-testid={props.testId}
        role="img"
        aria-label={props.label}
        tabIndex={props.interactive === true ? 0 : undefined}
        className={
          "block w-full rounded-md border border-surface " +
          (props.interactive === true
            ? "cursor-crosshair focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            : "")
        }
        style={{ height: `${props.heightPx}px` }}
        onPointerDown={props.onPointerDown}
        onPointerMove={props.onPointerMove}
        onPointerUp={props.onPointerUp}
        onKeyDown={props.onKeyDown}
      />
    </div>
  );
}
