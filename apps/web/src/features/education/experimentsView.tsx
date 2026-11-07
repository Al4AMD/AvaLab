import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import {
  EXPERIMENT_CATEGORIES,
  EXPERIMENTS,
  type ExperimentId,
  loadExperimentProgress,
  saveExperimentProgress,
} from "./experiments";

export function ExperimentsView(): React.ReactElement {
  const { t } = useTranslation();
  const storage = typeof window === "undefined" ? null : window.localStorage;
  const [completed, setCompleted] = useState(() => loadExperimentProgress(storage));

  const toggle = (id: ExperimentId): void => {
    setCompleted((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveExperimentProgress(storage, next);
      return next;
    });
  };

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold">{t("experiments.title")}</h2>
        <p className="max-w-3xl text-sm text-muted">{t("experiments.intro")}</p>
      </div>

      {EXPERIMENT_CATEGORIES.map((category) => {
        const experiments = EXPERIMENTS.filter((experiment) => experiment.category === category);
        if (experiments.length === 0) {
          return null;
        }
        return (
          <section
            key={category}
            data-testid={`experiments.category.${category}`}
            className="flex flex-col gap-3"
          >
            <h3 className="text-lg font-semibold">{t(`experiments.category.${category}`)}</h3>
            <div className="grid gap-4 lg:grid-cols-2">
              {experiments.map((experiment) => (
                <article
                  key={experiment.id}
                  data-testid={`experiments.card.${experiment.id}`}
                  className="flex flex-col gap-3 rounded-md border border-surface p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h4 className="font-semibold">{t(experiment.titleKey)}</h4>
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <input
                        type="checkbox"
                        data-testid={`experiments.progress.${experiment.id}`}
                        checked={completed.has(experiment.id)}
                        onChange={() => {
                          toggle(experiment.id);
                        }}
                      />
                      {t("experiments.completed")}
                    </label>
                  </div>
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
                            to={{
                              pathname: step.link.path,
                              search: step.link.search === "" ? "" : `?${step.link.search}`,
                            }}
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
      })}
    </section>
  );
}
