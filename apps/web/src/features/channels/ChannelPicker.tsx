import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/button";
import type { ChannelMode } from "../../lib/channel";

type ChannelPickerProps = {
  readonly mode: ChannelMode;
  readonly modes: readonly ChannelMode[];
  readonly onChange: (mode: ChannelMode) => void;
};

export function ChannelPicker({ mode, modes, onChange }: ChannelPickerProps) {
  const { t } = useTranslation();
  if (modes.length < 2) {
    return null;
  }
  const labels: Record<ChannelMode, string> = {
    mono: t("channel.mono"),
    left: t("channel.left"),
    right: t("channel.right"),
    both: t("channel.both"),
  };

  return (
    <div data-testid="channel.picker" className="flex flex-col gap-1">
      <fieldset className="flex flex-col gap-1 border-0 p-0 text-xs">
        <legend className="font-medium">{t("channel.label")}</legend>
        <div className="flex flex-wrap items-center gap-1">
          {modes.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={mode === option ? "default" : "outline"}
              aria-pressed={mode === option}
              data-testid={`channel.mode.${option}`}
              onClick={() => onChange(option)}
            >
              {labels[option]}
            </Button>
          ))}
        </div>
      </fieldset>
      <p className="text-xs text-muted">{t("channel.note")}</p>
    </div>
  );
}
