const VIEW_SIZE = 240;
const CENTER = VIEW_SIZE / 2;
const RADIUS = 100;

export type ComplexPoint = { readonly re: number; readonly im: number };

type PoleZeroPlotProps = {
  readonly poles: readonly ComplexPoint[];
  readonly zeros: readonly ComplexPoint[];
  readonly stable: boolean;
  readonly omitted: boolean;
  readonly title: string;
  readonly ariaLabel: string;
  readonly polesLabel: string;
  readonly zerosLabel: string;
  readonly stableLabel: string;
  readonly unstableLabel: string;
  readonly omittedLabel: string;
};

function finitePoints(points: readonly ComplexPoint[]): readonly ComplexPoint[] {
  return points.filter((point) => Number.isFinite(point.re) && Number.isFinite(point.im));
}

export function PoleZeroPlot({
  poles,
  zeros,
  stable,
  omitted,
  title,
  ariaLabel,
  polesLabel,
  zerosLabel,
  stableLabel,
  unstableLabel,
  omittedLabel,
}: PoleZeroPlotProps) {
  const finitePoles = finitePoints(poles);
  const finiteZeros = finitePoints(zeros);
  const all = [...finitePoles, ...finiteZeros];
  const extent = Math.max(1.2, ...all.map((point) => Math.hypot(point.re, point.im) * 1.15));
  const scale = RADIUS / extent;
  const toX = (re: number): number => CENTER + re * scale;
  const toY = (im: number): number => CENTER - im * scale;

  return (
    <figure dir="ltr" className="flex flex-col gap-1">
      <figcaption className="text-xs font-medium">{title}</figcaption>
      <svg
        data-testid="filters.poleZero"
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
        className="w-full max-w-xs rounded bg-bg ring-1 ring-surface"
      >
        <rect width={VIEW_SIZE} height={VIEW_SIZE} fill="#0b1220" />
        <line x1={CENTER} y1={0} x2={CENTER} y2={VIEW_SIZE} stroke="#334155" />
        <line x1={0} y1={CENTER} x2={VIEW_SIZE} y2={CENTER} stroke="#334155" />
        <circle
          cx={CENTER}
          cy={CENTER}
          r={scale}
          fill="none"
          stroke="#64748b"
          strokeDasharray="4 3"
        />
        {finiteZeros.map((zero) => (
          <circle
            key={`zero-${zero.re}-${zero.im}`}
            cx={toX(zero.re)}
            cy={toY(zero.im)}
            r={4}
            fill="none"
            stroke="#8bd3c7"
            strokeWidth={1.5}
          />
        ))}
        {finitePoles.map((pole) => {
          const x = toX(pole.re);
          const y = toY(pole.im);
          return (
            <g key={`pole-${pole.re}-${pole.im}`} stroke="#f59e0b" strokeWidth={1.5}>
              <line x1={x - 4} y1={y - 4} x2={x + 4} y2={y + 4} />
              <line x1={x - 4} y1={y + 4} x2={x + 4} y2={y - 4} />
            </g>
          );
        })}
        <text x={VIEW_SIZE - 6} y={CENTER - 6} textAnchor="end" fill="#8b98a5" fontSize={10}>
          Re
        </text>
        <text x={CENTER + 6} y={12} fill="#8b98a5" fontSize={10}>
          Im
        </text>
      </svg>
      <p
        data-testid="filters.poleZero.stability"
        className={`text-xs ${stable ? "text-muted" : "text-danger"}`}
      >
        {stable ? stableLabel : unstableLabel}
      </p>
      <p className="text-xs text-muted">
        {polesLabel}: {finitePoles.length} · {zerosLabel}: {finiteZeros.length}
      </p>
      {omitted ? <p className="text-xs text-muted">{omittedLabel}</p> : null}
    </figure>
  );
}
