import { useEffect, useRef } from "react";

const DEFAULT_HEIGHT_PX = 96;
const MAX_DEVICE_PIXEL_RATIO = 2;

type HistogramProps = {
  readonly histogram: readonly number[] | Uint32Array;
  readonly ariaLabel: string;
  readonly testId: string;
  readonly heightPx?: number;
  readonly color?: string;
};

/** Canvas histogram shared by analysis panels; bars are normalized to the
 * tallest bin and painted in the LTR technical-readout direction. */
export function Histogram({
  histogram,
  ariaLabel,
  testId,
  heightPx = DEFAULT_HEIGHT_PX,
  color = "#8bd3c7",
}: HistogramProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_DEVICE_PIXEL_RATIO);
    const widthDevicePx = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const heightDevicePx = Math.max(1, Math.round(heightPx * dpr));
    canvas.width = widthDevicePx;
    canvas.height = heightDevicePx;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }
    ctx.clearRect(0, 0, widthDevicePx, heightDevicePx);
    let max = 1;
    for (let index = 0; index < histogram.length; index += 1) {
      max = Math.max(max, histogram[index] ?? 0);
    }
    const barWidth = widthDevicePx / Math.max(1, histogram.length);
    ctx.fillStyle = color;
    for (let index = 0; index < histogram.length; index += 1) {
      const count = histogram[index] ?? 0;
      const height = (count / max) * heightDevicePx;
      if (height > 0) {
        ctx.fillRect(index * barWidth, heightDevicePx - height, Math.max(1, barWidth), height);
      }
    }
  }, [histogram, heightPx, color]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={ariaLabel}
      data-testid={testId}
      dir="ltr"
      style={{ height: `${heightPx}px` }}
      className="block w-full rounded bg-bg ring-1 ring-surface"
    />
  );
}
