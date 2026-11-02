/**
 * F05 quality-metrics lab (Wave-4 Plan 03 Task 3).
 *
 * Compares the immutable original source with the current processed lane.
 * Alignment is a precondition: unequal lengths or rates show a translated
 * hint instead of silently trimming or resampling. PSNR uses peak = 1.0 and
 * the note is always visible (AGENTS F05).
 */
import { useTranslation } from "react-i18next";

import { useSessionStore } from "../../session/store";
import { UploadEmptyState } from "../input/upload";
import { computeQualityMetrics, formatMetric, type QualityMetrics } from "./metrics";

function MetricCard({
  label,
  value,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly testId: string;
}) {
  return (
    <div className="rounded border border-surface p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd dir="ltr" data-testid={testId} className="mt-1 text-lg tabular-nums">
        {value}
      </dd>
    </div>
  );
}

export function MetricsView(): React.ReactElement {
  const { t } = useTranslation();
  const original = useSessionStore((state) => state.original);
  const processed = useSessionStore((state) => state.processed);

  if (original === null) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">{t("tool.metrics.title")}</h2>
        <UploadEmptyState />
      </section>
    );
  }

  let metrics: QualityMetrics | null = null;
  let problem: "missing" | "lengthMismatch" | "rateMismatch" | null =
    processed === null ? "missing" : null;
  if (processed !== null) {
    if (processed.sampleRateHz !== original.sampleRateHz) {
      problem = "rateMismatch";
    } else if (processed.samples.length !== original.samples.length) {
      problem = "lengthMismatch";
    } else {
      try {
        metrics = computeQualityMetrics(original.samples, processed.samples, original.sampleRateHz);
      } catch {
        problem = "lengthMismatch";
      }
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold">{t("tool.metrics.title")}</h2>

      {problem === "missing" ? (
        <p data-testid="metrics.missing" className="text-sm text-muted">
          {t("metrics.missing")}
        </p>
      ) : null}
      {problem === "lengthMismatch" ? (
        <p data-testid="metrics.mismatch.length" className="text-sm text-muted">
          {t("metrics.mismatch.length")}
        </p>
      ) : null}
      {problem === "rateMismatch" ? (
        <p data-testid="metrics.mismatch.rate" className="text-sm text-muted">
          {t("metrics.mismatch.rate")}
        </p>
      ) : null}

      {metrics !== null ? (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard
              label={t("metrics.label.mse")}
              value={formatMetric(metrics.mse, 6)}
              testId="metrics.value.mse"
            />
            <MetricCard
              label={t("metrics.label.snr")}
              value={`${formatMetric(metrics.snrDb)} dB`}
              testId="metrics.value.snr"
            />
            <MetricCard
              label={t("metrics.label.segmentalSnr")}
              value={`${formatMetric(metrics.segmentalSnrDb)} dB`}
              testId="metrics.value.segmentalSnr"
            />
            <MetricCard
              label={t("metrics.label.psnr")}
              value={`${formatMetric(metrics.psnrDb)} dB`}
              testId="metrics.value.psnr"
            />
            <MetricCard
              label={t("metrics.label.samples")}
              value={String(metrics.sampleCount)}
              testId="metrics.value.samples"
            />
          </dl>
          <p className="text-xs text-muted">{t("metrics.psnrNote")}</p>
          <p className="text-xs text-muted">
            {t("metrics.processedLabel", { label: processed?.label ?? "" })}
          </p>
          {processed?.label.startsWith("codecLab") ? (
            <p data-testid="metrics.codecNote" className="text-xs text-muted">
              {t("metrics.codecNote")}
            </p>
          ) : null}
        </>
      ) : null}

      <details className="rounded border border-surface p-3 text-sm">
        <summary className="cursor-pointer font-semibold">{t("metrics.theory.title")}</summary>
        <div className="mt-2 flex flex-col gap-2 text-xs text-muted">
          <p>{t("metrics.theory.energy")}</p>
          <p>{t("metrics.theory.segmental")}</p>
          <p>{t("metrics.theory.psnr")}</p>
          <div>
            <h4 className="font-semibold text-text">{t("metrics.observe.title")}</h4>
            <ul className="ms-4 list-disc">
              <li>{t("metrics.observe.lossless")}</li>
              <li>{t("metrics.observe.lossy")}</li>
              <li>{t("metrics.observe.bitrate")}</li>
            </ul>
          </div>
        </div>
      </details>
    </section>
  );
}
