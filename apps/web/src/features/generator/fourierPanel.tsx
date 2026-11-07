/**
 * F12 Fourier-series panel: the worker builds the partial sum with the
 * existing `fourierSeriesPartialSum` and measures the Gibbs overshoot; the
 * ideal waveform comes from the existing generator math. This file only
 * edits settings and draws the two bucketed previews.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSessionStore } from "../../session/store";
import { GeneratorPreview } from "./generatorPreview";
import {
  FOURIER_KINDS,
  FOURIER_MAX_HARMONICS,
  FOURIER_MIN_HARMONICS,
  type FourierKind,
  type GeneratorSettings,
} from "./generatorState";

const FOURIER_PREVIEW_BUCKETS = 512;
const FOURIER_PREVIEW_MAX_SECONDS = 2;
const CONTROL_FOCUS_CLASSES =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const INPUT_CLASSES = `rounded border border-surface bg-bg px-2 py-1 text-sm ${CONTROL_FOCUS_CLASSES}`;

export const GIBBS_THEORETICAL_RATIO = 0.0895;

function unpackBuckets(
  payload: { buffer: ArrayBuffer; byteOffset: number; byteLength: number } | undefined,
): Float32Array | null {
  if (payload === undefined) {
    return null;
  }
  return new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
}

export function FourierPanel({
  settings,
  update,
}: {
  readonly settings: GeneratorSettings;
  readonly update: (patch: Partial<GeneratorSettings>) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [partial, setPartial] = useState<Float32Array | null>(null);
  const [ideal, setIdeal] = useState<Float32Array | null>(null);
  const [overshootRatio, setOvershootRatio] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const generationRef = useRef(0);
  const previewDurationSeconds = Math.min(settings.durationSeconds, FOURIER_PREVIEW_MAX_SECONDS);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    setFailed(false);
    const timer = window.setTimeout(() => {
      const partialTicket = useSessionStore.getState().deriveStandalone("fourierPreview", {
        kind: settings.fourierKind,
        sampleRateHz: settings.sampleRateHz,
        durationSeconds: previewDurationSeconds,
        amplitude: settings.amplitude,
        frequencyHz: settings.frequencyHz,
        harmonics: settings.fourierHarmonics,
        previewBucketCount: FOURIER_PREVIEW_BUCKETS,
      });
      const idealTicket = useSessionStore.getState().deriveStandalone("generateSynth", {
        waveform: settings.fourierKind,
        sampleRateHz: settings.sampleRateHz,
        durationSeconds: previewDurationSeconds,
        amplitude: settings.amplitude,
        frequencyHz: settings.frequencyHz,
        previewBucketCount: FOURIER_PREVIEW_BUCKETS,
      });
      Promise.all([partialTicket.outcome, idealTicket.outcome]).then(
        ([partialOutcome, idealOutcome]) => {
          if (generationRef.current !== generation) {
            return;
          }
          if ("cancelled" in partialOutcome || "cancelled" in idealOutcome) {
            return;
          }
          const partialBuckets = unpackBuckets(partialOutcome.payload);
          const idealBuckets = unpackBuckets(idealOutcome.payload);
          if (partialBuckets === null || idealBuckets === null) {
            setFailed(true);
            return;
          }
          setPartial(partialBuckets);
          setIdeal(idealBuckets);
          setOvershootRatio(partialOutcome.meta.overshootRatio);
        },
        () => {
          if (generationRef.current === generation) {
            setFailed(true);
          }
        },
      );
    }, 120);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    settings.fourierKind,
    settings.sampleRateHz,
    settings.amplitude,
    settings.frequencyHz,
    settings.fourierHarmonics,
    previewDurationSeconds,
  ]);

  return (
    <div className="flex flex-col gap-3 rounded border border-surface p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("generator.fourier.kindLabel")}</span>
          <select
            value={settings.fourierKind}
            data-testid="generator.control.fourierKind"
            onChange={(event) => {
              const value = event.currentTarget.value;
              if ((FOURIER_KINDS as readonly string[]).includes(value)) {
                update({ fourierKind: value as FourierKind });
              }
            }}
            className={INPUT_CLASSES}
          >
            {FOURIER_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`generator.fourier.kind.${kind}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="flex items-center justify-between gap-2 font-medium">
            <span>{t("generator.fourier.harmonics")}</span>
            <span dir="ltr" className="tabular-nums">
              {settings.fourierHarmonics}
            </span>
          </span>
          <input
            type="range"
            min={FOURIER_MIN_HARMONICS}
            max={FOURIER_MAX_HARMONICS}
            step={1}
            value={settings.fourierHarmonics}
            data-testid="generator.control.fourierHarmonics"
            onChange={(event) => update({ fourierHarmonics: Number(event.currentTarget.value) })}
            className={`w-full ${CONTROL_FOCUS_CLASSES}`}
          />
        </label>
      </div>

      {failed ? (
        <p role="alert" data-testid="generator.fourier.error" className="text-xs text-danger">
          {t("generator.fourier.error")}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium">{t("generator.fourier.partial")}</span>
            <GeneratorPreview
              minMax={partial}
              ariaLabel={t("generator.fourier.partial")}
              testId="generator.fourier.preview.partial"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium">{t("generator.fourier.ideal")}</span>
            <GeneratorPreview
              minMax={ideal}
              ariaLabel={t("generator.fourier.ideal")}
              testId="generator.fourier.preview.ideal"
            />
          </div>
        </div>
      )}

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <div className="flex items-center gap-1">
          <dt>{t("generator.fourier.measured")}</dt>
          <dd dir="ltr" data-testid="generator.fourier.overshoot" className="tabular-nums">
            {overshootRatio === null ? "—" : `${(overshootRatio * 100).toFixed(2)} %`}
          </dd>
        </div>
        <div className="flex items-center gap-1">
          <dt>{t("generator.fourier.theoretical")}</dt>
          <dd dir="ltr" data-testid="generator.fourier.theoretical" className="tabular-nums">
            {(GIBBS_THEORETICAL_RATIO * 100).toFixed(2)} %
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted">{t("generator.fourier.hint")}</p>
    </div>
  );
}
