import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { EXPERIMENTS } from "./experiments";

export function ExperimentsView(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold">{t("experiments.title")}</h2>
      <p className="max-w-3xl text-sm text-muted">{t("experiments.intro")}</p>

      <div className="grid gap-4 lg:grid-cols-3">
        {EXPERIMENTS.map((experiment) => (
          <article
            key={experiment.id}
            data-testid={`experiments.card.${experiment.id}`}
            className="flex flex-col gap-3 rounded-md border border-surface p-4"
          >
            <h3 className="font-semibold">{t(experiment.titleKey)}</h3>
            <p className="text-sm text-muted">{t(experiment.goalKey)}</p>
            <ol className="flex flex-col gap-3 text-sm">
              {experiment.steps.map((step, index) => (
                <li
                  key={step.instructionKey}
                  data-testid={`experiments.step.${experiment.id}.${index}`}
                  className="flex flex-col gap-1"
                >
                  <p>
                    <span className="font-medium" dir="ltr">
                      {index + 1}.
                    </span>{" "}
                    {t(step.instructionKey)}
                  </p>
                  <p className="text-muted">
                    <span className="font-medium">{t("experiments.observationLabel")}:</span>{" "}
                    {t(step.observationKey)}
                  </p>
                  {step.link !== undefined ? (
                    <Link
                      to={{ pathname: step.link.path, search: `?${step.link.search}` }}
                      className="text-sm text-accent underline underline-offset-2"
                    >
                      {t("experiments.openLab")}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}
