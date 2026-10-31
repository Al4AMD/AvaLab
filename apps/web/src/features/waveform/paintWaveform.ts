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
  readonly sampleRange?: SampleRange;
  readonly playheadSample?: number;
  readonly selectionRange?: SampleRange;
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

/** Vertical CSS-pixel position for a sample in [-1, 1]. */
export function waveformY(value: number, heightPx: number): number {
  const clamped = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
  return ((1 - clamped) / 2) * heightPx;
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

  if (options.sampleRange !== undefined && options.selectionRange !== undefined) {
    const startX = rangeX(options.selectionRange.startSample, options.sampleRange, widthPx, dpr);
    const endX = rangeX(options.selectionRange.endSample, options.sampleRange, widthPx, dpr);
    ctx.fillStyle = options.selection;
    ctx.fillRect(Math.min(startX, endX), 0, Math.abs(endX - startX), heightPx);
  }

  const bucketCount = Math.floor(minMax.length / 2);
  ctx.fillStyle = options.wave;
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const min = minMax[2 * bucket] ?? 0;
    const max = minMax[2 * bucket + 1] ?? 0;
    const x = bucketToX(bucket, bucketCount, widthPx, dpr);
    const nextX = bucketToX(bucket + 1, bucketCount, widthPx, dpr);
    const top = waveformY(max, heightPx);
    const bottom = waveformY(min, heightPx);
    ctx.fillRect(x, top, Math.max(1, nextX - x), Math.max(1, bottom - top));
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
