const PLOT_WIDTH = 640;
const PLOT_HEIGHT = 180;
const PLOT_MARGIN = { left: 62, right: 14, top: 10, bottom: 32 } as const;

type FilterLinePlotProps = {
  readonly x: readonly number[];
  readonly y: readonly number[];
  readonly xLabel: string;
  readonly yLabel: string;
  readonly ariaLabel: string;
  readonly emptyLabel: string;
  readonly testId: string;
  readonly color?: string;
  readonly xFormat: (value: number) => string;
  readonly yFormat: (value: number) => string;
};

function finitePairs(
  x: readonly number[],
  y: readonly number[],
): readonly { readonly x: number; readonly y: number }[] {
  const count = Math.min(x.length, y.length);
  const pairs: { x: number; y: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    const px = x[index];
    const py = y[index];
    if (px !== undefined && py !== undefined && Number.isFinite(px) && Number.isFinite(py)) {
      pairs.push({ x: px, y: py });
    }
  }
  return pairs;
}

/** Pure SVG line plot: no DOM measurement, so it renders in tests and never
 * shifts the main thread. Technical axes stay LTR in both locales. */
export function FilterLinePlot({
  x,
  y,
  xLabel,
  yLabel,
  ariaLabel,
  emptyLabel,
  testId,
  color = "#38bdf8",
  xFormat,
  yFormat,
}: FilterLinePlotProps) {
  const pairs = finitePairs(x, y);
  if (pairs.length < 2) {
    return (
      <p dir="ltr" data-testid={`${testId}.empty`} className="text-xs text-muted">
        {emptyLabel}
      </p>
    );
  }
  const xs = pairs.map((point) => point.x);
  const ys = pairs.map((point) => point.y);
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  if (minX === maxX) {
    minX -= 1;
    maxX += 1;
  }
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }
  const plotWidth = PLOT_WIDTH - PLOT_MARGIN.left - PLOT_MARGIN.right;
  const plotHeight = PLOT_HEIGHT - PLOT_MARGIN.top - PLOT_MARGIN.bottom;
  const sx = (value: number): number =>
    PLOT_MARGIN.left + ((value - minX) / (maxX - minX)) * plotWidth;
  const sy = (value: number): number =>
    PLOT_MARGIN.top + plotHeight - ((value - minY) / (maxY - minY)) * plotHeight;
  const points = pairs
    .map((point) => `${sx(point.x).toFixed(2)},${sy(point.y).toFixed(2)}`)
    .join(" ");

  return (
    <figure dir="ltr" className="flex flex-col gap-1">
      <svg
        data-testid={testId}
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
        className="w-full rounded bg-bg ring-1 ring-surface"
      >
        <rect width={PLOT_WIDTH} height={PLOT_HEIGHT} fill="#0b1220" />
        <line
          x1={PLOT_MARGIN.left}
          y1={PLOT_MARGIN.top}
          x2={PLOT_MARGIN.left}
          y2={PLOT_MARGIN.top + plotHeight}
          stroke="#334155"
        />
        <line
          x1={PLOT_MARGIN.left}
          y1={PLOT_MARGIN.top + plotHeight}
          x2={PLOT_MARGIN.left + plotWidth}
          y2={PLOT_MARGIN.top + plotHeight}
          stroke="#334155"
        />
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <text x={PLOT_MARGIN.left} y={PLOT_HEIGHT - 4} fill="#8b98a5" fontSize={10}>
          {xFormat(minX)}
        </text>
        <text
          x={PLOT_MARGIN.left + plotWidth}
          y={PLOT_HEIGHT - 4}
          textAnchor="end"
          fill="#8b98a5"
          fontSize={10}
        >
          {xFormat(maxX)}
        </text>
        <text x={4} y={PLOT_MARGIN.top + 8} fill="#8b98a5" fontSize={10}>
          {yFormat(maxY)}
        </text>
        <text x={4} y={PLOT_MARGIN.top + plotHeight} fill="#8b98a5" fontSize={10}>
          {yFormat(minY)}
        </text>
        <text
          x={PLOT_MARGIN.left + plotWidth / 2}
          y={PLOT_HEIGHT - 14}
          textAnchor="middle"
          fill="#8b98a5"
          fontSize={10}
        >
          {xLabel}
        </text>
        <text
          x={12}
          y={PLOT_MARGIN.top + plotHeight / 2}
          textAnchor="middle"
          fill="#8b98a5"
          fontSize={10}
          transform={`rotate(-90 12 ${PLOT_MARGIN.top + plotHeight / 2})`}
        >
          {yLabel}
        </text>
      </svg>
    </figure>
  );
}
