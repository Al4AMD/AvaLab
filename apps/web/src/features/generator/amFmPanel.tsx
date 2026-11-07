/**
 * F12 AM/FM controls. Both waveforms dispatch to the existing harmonic
 * generators in `packages/dsp`; this panel only edits generator settings.
 */
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/button";
import type { GeneratorSettings } from "./generatorState";

const CONTROL_FOCUS_CLASSES =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const INPUT_CLASSES = `rounded border border-surface bg-bg px-2 py-1 text-sm ${CONTROL_FOCUS_CLASSES}`;

export function AmFmPanel({
  settings,
  update,
}: {
  readonly settings: GeneratorSettings;
  readonly update: (patch: Partial<GeneratorSettings>) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const isAm = settings.waveform === "am";

  return (
    <div className="flex flex-col gap-3 rounded border border-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{t("generator.amFm.mode")}</span>
        <Button
          size="sm"
          variant={isAm ? "default" : "outline"}
          aria-pressed={isAm}
          data-testid="generator.amFm.am"
          onClick={() => update({ waveform: "am" })}
        >
          {t("generator.waveform.am")}
        </Button>
        <Button
          size="sm"
          variant={!isAm ? "default" : "outline"}
          aria-pressed={!isAm}
          data-testid="generator.amFm.fm"
          onClick={() => update({ waveform: "fm" })}
        >
          {t("generator.waveform.fm")}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("generator.amFm.carrier")}</span>
          <input
            type="number"
            min={1}
            max={48000}
            step={1}
            value={settings.frequencyHz}
            data-testid="generator.control.frequency"
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value) && value > 0 && value <= 48000) {
                update({ frequencyHz: value });
              }
            }}
            className={`${INPUT_CLASSES} tabular-nums`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("generator.amFm.modulation")}</span>
          <input
            type="number"
            min={0.1}
            max={20000}
            step={0.1}
            value={settings.modulationHz}
            data-testid="generator.control.modulationHz"
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value) && value >= 0.1 && value <= 20000) {
                update({ modulationHz: value });
              }
            }}
            className={`${INPUT_CLASSES} tabular-nums`}
          />
        </label>

        {isAm ? (
          <label className="flex flex-col gap-1 text-xs">
            <span className="flex items-center justify-between gap-2 font-medium">
              <span>{t("generator.amFm.index")}</span>
              <span dir="ltr" className="tabular-nums">
                {settings.modulationIndex.toFixed(2)}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={10}
              step={0.01}
              value={settings.modulationIndex}
              data-testid="generator.control.modulationIndex"
              onChange={(event) => update({ modulationIndex: Number(event.currentTarget.value) })}
              className={`w-full ${CONTROL_FOCUS_CLASSES}`}
            />
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">{t("generator.amFm.deviation")}</span>
            <input
              type="number"
              min={0}
              max={20000}
              step={1}
              value={settings.frequencyDeviationHz}
              data-testid="generator.control.frequencyDeviation"
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isFinite(value) && value >= 0 && value <= 20000) {
                  update({ frequencyDeviationHz: value });
                }
              }}
              className={`${INPUT_CLASSES} tabular-nums`}
            />
          </label>
        )}
      </div>

      {isAm && settings.modulationIndex > 1 ? (
        <p role="status" data-testid="generator.amFm.warning" className="text-xs text-danger">
          {t("generator.amFm.overmodulation")}
        </p>
      ) : null}
      <p className="text-xs text-muted">
        {isAm ? t("generator.amFm.amHint") : t("generator.amFm.fmHint")}
      </p>
    </div>
  );
}
