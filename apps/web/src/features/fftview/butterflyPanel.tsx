import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/button";
import type { FftButterflyResult } from "../../session/ops";
import { useSessionStore } from "../../session/store";

type ButterflyStep = FftButterflyResult["meta"]["steps"][number];

export const BUTTERFLY_SIZES = [8, 16] as const;
type ButterflySize = (typeof BUTTERFLY_SIZES)[number];

function formatComplex(real: number, imaginary: number): string {
  const sign = imaginary < 0 ? "−" : "+";
  return `${real.toFixed(3)} ${sign} j${Math.abs(imaginary).toFixed(3)}`;
}

export function ButterflyPanel({ startSample }: { readonly startSample: number }) {
  const { t } = useTranslation();
  const [size, setSize] = useState<ButterflySize>(8);
  const [steps, setSteps] = useState<readonly ButterflyStep[] | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState(false);
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    setSteps(null);
    setError(false);
    setStepIndex(0);
    const ticket = useSessionStore
      .getState()
      .deriveWithSourceSlice(
        "fftButterfly",
        { fftLengthSamples: size, startSample },
        startSample,
        startSample + size,
      );
    ticket.outcome.then(
      (outcome) => {
        if (generationRef.current !== generation || "cancelled" in outcome) {
          return;
        }
        setSteps(outcome.meta.steps);
        setStepIndex(0);
      },
      () => {
        if (generationRef.current === generation) {
          setError(true);
        }
      },
    );
    return () => {
      useSessionStore.getState().cancel(ticket.key);
    };
  }, [size, startSample]);

  const step = steps?.[stepIndex] ?? null;

  return (
    <section className="flex flex-col gap-3 rounded border border-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("fftview.butterfly.title")}</h3>
        <label className="flex items-center gap-2 text-xs">
          <span>{t("fftview.butterfly.size")}</span>
          <select
            value={size}
            data-testid="fftview.butterfly.size"
            onChange={(event) => setSize(Number(event.currentTarget.value) === 16 ? 16 : 8)}
            className="rounded border border-surface bg-bg px-2 py-1 text-sm"
          >
            {BUTTERFLY_SIZES.map((option) => (
              <option key={option} value={option}>
                N = {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-muted" data-testid="fftview.butterfly.error">
          {t("fftview.butterfly.error")}
        </p>
      ) : step === null ? (
        <p className="text-xs text-muted" data-testid="fftview.butterfly.loading">
          {t("fftview.butterfly.loading")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
              data-testid="fftview.butterfly.previous"
            >
              {t("fftview.butterfly.previous")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={steps === null || stepIndex >= steps.length - 1}
              onClick={() => setStepIndex((index) => Math.min((steps?.length ?? 1) - 1, index + 1))}
              data-testid="fftview.butterfly.next"
            >
              {t("fftview.butterfly.next")}
            </Button>
            <span
              dir="ltr"
              className="text-xs tabular-nums text-muted"
              data-testid="fftview.butterfly.step"
            >
              {stepIndex + 1}/{steps?.length ?? 0}
            </span>
          </div>
          <dl
            className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs"
            data-testid="fftview.butterfly.values"
          >
            <dt>{t("fftview.butterfly.stage")}</dt>
            <dd dir="ltr" className="tabular-nums">
              {step.stage}
            </dd>
            <dt>{t("fftview.butterfly.indices")}</dt>
            <dd dir="ltr" className="tabular-nums">
              {step.evenIndex}, {step.oddIndex}
            </dd>
            <dt>{t("fftview.butterfly.twiddle")}</dt>
            <dd dir="ltr" className="tabular-nums">
              {formatComplex(step.twiddleRe, step.twiddleIm)}
            </dd>
            <dt>{t("fftview.butterfly.inputEven")}</dt>
            <dd dir="ltr" className="tabular-nums">
              {formatComplex(step.inputEven, step.inputEvenIm)}
            </dd>
            <dt>{t("fftview.butterfly.inputOdd")}</dt>
            <dd dir="ltr" className="tabular-nums">
              {formatComplex(step.inputOdd, step.inputOddIm)}
            </dd>
            <dt>{t("fftview.butterfly.outputEven")}</dt>
            <dd dir="ltr" className="tabular-nums">
              {formatComplex(step.outputEvenRe, step.outputEvenIm)}
            </dd>
            <dt>{t("fftview.butterfly.outputOdd")}</dt>
            <dd dir="ltr" className="tabular-nums">
              {formatComplex(step.outputOddRe, step.outputOddIm)}
            </dd>
          </dl>
          <p className="text-xs text-muted">{t("fftview.butterfly.note")}</p>
        </>
      )}
    </section>
  );
}
