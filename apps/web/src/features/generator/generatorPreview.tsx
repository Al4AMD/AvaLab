/** Shared generator preview canvas: draws worker-bucketed samples only. */
import { useEffect, useRef, useState } from "react";

import { paintGeneratorPreview } from "./genPreviewCanvas";

const PREVIEW_HEIGHT_PX = 140;

export function GeneratorPreview({
  minMax,
  ariaLabel,
  testId = "generator.preview.canvas",
}: {
  readonly minMax: Float32Array | null;
  readonly ariaLabel: string;
  readonly testId?: string;
}): React.ReactElement {
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
    if (canvas !== null && minMax !== null) {
      paintGeneratorPreview(canvas, minMax, widthPx, PREVIEW_HEIGHT_PX);
    }
  }, [minMax, widthPx]);

  return (
    <div ref={hostRef} dir="ltr">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        data-testid={testId}
        style={{ height: `${PREVIEW_HEIGHT_PX}px` }}
        className="block w-full rounded bg-bg ring-1 ring-surface"
      />
    </div>
  );
}
