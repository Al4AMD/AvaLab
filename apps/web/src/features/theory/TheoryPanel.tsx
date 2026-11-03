import { useTranslation } from "react-i18next";

import { Formula } from "./Formula";

type TheorySection = {
  readonly headingKey: string;
  readonly bodyKey: string;
  readonly formula?: string;
  readonly bulletKeys?: readonly string[];
};

type TheoryPanelProps = {
  readonly titleKey: string;
  readonly sections: readonly TheorySection[];
};

export function TheoryPanel({ titleKey, sections }: TheoryPanelProps) {
  const { t } = useTranslation();

  return (
    <details className="rounded border border-surface p-3 text-sm" data-testid="theory.panel">
      <summary className="cursor-pointer font-semibold">{t(titleKey)}</summary>
      <div className="mt-3 flex flex-col gap-4">
        {sections.map((section) => (
          <section key={section.headingKey}>
            <h3 className="font-medium">{t(section.headingKey)}</h3>
            <p className="mt-1 leading-relaxed text-muted">{t(section.bodyKey)}</p>
            {section.formula ? <Formula tex={section.formula} display /> : null}
            {section.bulletKeys && section.bulletKeys.length > 0 ? (
              <ul className="ms-4 mt-1 list-disc space-y-1 text-muted">
                {section.bulletKeys.map((key) => (
                  <li key={key}>{t(key)}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </details>
  );
}
