import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

type ToolHeaderProps = {
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly trailing?: ReactNode;
};

/** One title/description block so every tool header has the same hierarchy. */
export function ToolHeader({ titleKey, descriptionKey, trailing }: ToolHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-2xl font-semibold">{t(titleKey)}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t(descriptionKey)}</p>
      </div>
      {trailing}
    </header>
  );
}
