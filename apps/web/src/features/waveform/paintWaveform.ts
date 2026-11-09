/**
 * Pure waveform painter (F02). It draws a min/max envelope that lives in a
 * cached typed array; no DSP and no allocation in the paint path.
 *
 * Bucket b covers the horizontal cell [b/B, (b+1)/B) of the canvas, so the
 * mapping is linear and the last bucket never draws past the right edge. The
 * vertical scale is fixed to [-1, 1] (the readout prints the actual peak), so
 * a quiet signal looks quiet instead of being silently normalized. Device
 * pixels are handled once at the canvas backing-store level (`dpr`), and all
 * drawing below is in CSS pixels through the transform.
 */

export type SampleRange = {
  readonly startSample: number;
  readonly endSample: number;
};

export type WaveformPaintOptions = {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly dpr: number;
  readonly background: string;
  readonly wave: string;
  readonly center: string;
  readonly playhead: string;
  readonly selection: string;
  readonly selectionBorder?: string;
  readonly sampleRange?: SampleRange;
  readonly playheadSample?: number;
  readonly selectionRange?: SampleRange;
  /** Detail window currently shown below the overview; drawn as a band. */
  readonly viewportRange?: SampleRange;
  /** Absolute sample value mapped to the top/bottom edge (default 1). */
  readonly verticalScale?: number;
};

/** Horizontal device-pixel position of a bucket's start. */
export function bucketToX(
  bucketIndex: number,
  bucketCount: number,
  widthPx: number,
  dpr: number,
): number {
  if (bucketCount <= 0 || widthPx <= 0 || dpr <= 0) {
    return 0;
  }
  return (bucketIndex / bucketCount) * widthPx * dpr;
}

/** Vertical CSS-pixel position for a sample in [-scale, scale]. */
export function waveformY(value: number, heightPx: number, verticalScale = 1): number {
  const scale = Number.isFinite(verticalScale) && verticalScale > 0 ? verticalScale : 1;
  const clamped = Math.max(-scale, Math.min(scale, Number.isFinite(value) ? value : 0));
  return ((1 - clamped / scale) / 2) * heightPx;
}

function clampSample(sample: number, range: SampleRange): number {
  return Math.max(range.startSample, Math.min(range.endSample, sample));
}

function rangeX(sample: number, sampleRange: SampleRange, widthPx: number, dpr: number): number {
  const span = sampleRange.endSample - sampleRange.startSample;
  if (span <= 0) {
    return 0;
  }
  return ((clampSample(sample, sampleRange) - sampleRange.startSample) / span) * widthPx * dpr;
}

/**
 * Paint the envelope. `minMax` is the interleaved [min, max] pair array from
 * `computePeakBuckets`; an empty array paints the background, center line and
 * overlays only. Out-of-range values are clamped to the fixed scale, never
 * renormalized.
 */
export function paintWaveform(
  ctx: CanvasRenderingContext2D,
  minMax: Float32Array,
  options: WaveformPaintOptions,
): void {
  const { widthPx, heightPx, dpr } = options;
  ctx.canvas.width = Math.max(1, Math.round(widthPx * dpr));
  ctx.canvas.height = Math.max(1, Math.round(heightPx * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = options.background;
  ctx.fillRect(0, 0, widthPx, heightPx);

  if (options.sampleRange !== undefined && options.viewportRange !== undefined) {
    const startX = rangeX(options.viewportRange.startSample, options.sampleRange, widthPx, dpr);
    const endX = rangeX(options.viewportRange.endSample, options.sampleRange, widthPx, dpr);
    const left = Math.min(startX, endX);
    const right = Math.max(startX, endX);
    ctx.fillStyle = "rgba(241, 238, 228, 0.10)";
    ctx.fillRect(left, 0, Math.max(1, right - left), heightPx);
  }

  if (options.sampleRange !== undefined && options.selectionRange !== undefined) {
    const startX = rangeX(options.selectionRange.startSample, options.sampleRange, widthPx, dpr);
    const endX = rangeX(options.selectionRange.endSample, options.sampleRange, widthPx, dpr);
    const left = Math.min(startX, endX);
    const right = Math.max(startX, endX);
    ctx.fillStyle = options.selection;
    ctx.fillRect(left, 0, Math.max(1, right - left), heightPx);
  }

  const bucketCount = Math.floor(minMax.length / 2);
  const scale = options.verticalScale ?? 1;
  const sampleSpan =
    options.sampleRange === undefined
      ? 0
      : options.sampleRange.endSample - options.sampleRange.startSample;
  ctx.fillStyle = options.wave;
  if (options.sampleRange !== undefined && bucketCount > 0 && bucketCount === sampleSpan) {
    // One bucket per sample: connect the exact samples instead of painting
    // the 1-px envelope bars, so a zoomed-in view shows the real values.
    ctx.strokeStyle = options.wave;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
      const sample = minMax[2 * bucket + 1] ?? 0;
      const x = rangeX(
        options.sampleRange.startSample + bucket + 0.5,
        options.sampleRange,
        widthPx,
        dpr,
      );
      const y = waveformY(sample, heightPx, scale);
      if (bucket === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  } else {
    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
      const min = minMax[2 * bucket] ?? 0;
      const max = minMax[2 * bucket + 1] ?? 0;
      const x = bucketToX(bucket, bucketCount, widthPx, dpr);
      const nextX = bucketToX(bucket + 1, bucketCount, widthPx, dpr);
      const top = waveformY(max, heightPx, scale);
      const bottom = waveformY(min, heightPx, scale);
      ctx.fillRect(x, top, Math.max(1, nextX - x), Math.max(1, bottom - top));
    }
  }

  if (options.sampleRange !== undefined && options.viewportRange !== undefined) {
    const startX = rangeX(options.viewportRange.startSample, options.sampleRange, widthPx, dpr);
    const endX = rangeX(options.viewportRange.endSample, options.sampleRange, widthPx, dpr);
    const left = Math.min(startX, endX);
    const right = Math.max(startX, endX);
    ctx.fillStyle = options.wave;
    ctx.fillRect(left, 0, 1, heightPx);
    ctx.fillRect(Math.max(left, right - 1), 0, 1, heightPx);
  }

  if (options.sampleRange !== undefined && options.selectionRange !== undefined) {
    const startX = rangeX(options.selectionRange.startSample, options.sampleRange, widthPx, dpr);
    const endX = rangeX(options.selectionRange.endSample, options.sampleRange, widthPx, dpr);
    const left = Math.min(startX, endX);
    const right = Math.max(startX, endX);
    ctx.fillStyle = options.selectionBorder ?? options.wave;
    ctx.fillRect(left, 0, 1, heightPx);
    ctx.fillRect(Math.max(left, right - 1), 0, 1, heightPx);
  }

  ctx.strokeStyle = options.center;
  ctx.beginPath();
  ctx.moveTo(0, heightPx / 2);
  ctx.lineTo(widthPx, heightPx / 2);
  ctx.stroke();

  if (options.sampleRange !== undefined && options.playheadSample !== undefined) {
    const playhead = options.playheadSample;
    if (playhead >= options.sampleRange.startSample && playhead <= options.sampleRange.endSample) {
      const x = rangeX(playhead, options.sampleRange, widthPx, dpr);
      ctx.strokeStyle = options.playhead;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, heightPx);
      ctx.stroke();
    }
  }
}
