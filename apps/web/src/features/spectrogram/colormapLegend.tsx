/**
 * Colormap legend (F02, Wave 2 Plan 03 Task 4) — one gradient strip with
 * BOTH dB ends printed, so level is never conveyed by colour alone (AGENTS
 * §9, plan Review Focus 4). The gradient uses the same hardcoded LUT stops
 * as the painter.
 */
import { formatDb } from "../../lib/format";
import { colormapGradientCss, type SpectrogramColormapName } from "./paintSpectrogram";

type ColormapLegendProps = {
  readonly label: string;
  readonly colormap: SpectrogramColormapName;
  readonly dbMinDb: number;
  readonly dbMaxDb: number;
};

export function ColormapLegend({ label, colormap, dbMinDb, dbMaxDb }: ColormapLegendProps) {
  return (
    <div className="flex items-center gap-2">
      <span>{label}</span>
      <span dir="ltr" data-testid="spectrogram.legend.min" className="tabular-nums">
        {formatDb(dbMinDb)}
      </span>
      <div
        aria-hidden="true"
        data-testid="spectrogram.legend.gradient"
        className="h-2 w-32 rounded"
        style={{ background: colormapGradientCss(colormap) }}
      />
      <span dir="ltr" data-testid="spectrogram.legend.max" className="tabular-nums">
        {formatDb(dbMaxDb)}
      </span>
    </div>
  );
}
