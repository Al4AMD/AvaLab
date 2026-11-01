/**
 * Signal generator (F12, Wave-2 Plan 04 Task 3): parameter panel over the
 * wave-1 dsp generators. The preview is bucketed by the `generateSynth` op
 * in the worker (never synthesized on the main thread) and "load as source"
 * routes the full sample buffer through the store's `loadSource` guard.
 *
 * Settings ride the URL (F16 share) and localStorage remembers the last
 * panel for the session; audio itself is never persisted. The 300 s / 96 kHz
 * source caps are enforced here for honest UX and again by the op and store.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";

import { Button } from "../../components/ui/button";
import { formatS } from "../../lib/format";
import type { GenerateSynthParams, SynthWaveform } from "../../session/ops";
import { useSessionStore } from "../../session/store";
import {
  GENERATOR_MAX_DURATION_S,
  GENERATOR_SAMPLE_RATES,
  GENERATOR_STORAGE_KEY,
  GENERATOR_WAVEFORMS,
  type GeneratorSettings,
  generatorSettingsFromSearch,
  generatorSettingsToSearch,
} from "./generatorState";
import { paintGeneratorPreview } from "./genPreviewCanvas";

const PREVIEW_BUCKETS = 512;
const PREVIEW_HEIGHT_PX = 140;
const CONTROL_FOCUS_CLASSES =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const INPUT_CLASSES = `rounded border border-surface bg-bg px-2 py-1 text-sm ${CONTROL_FOCUS_CLASSES}`;

function readStoredSettings(): GeneratorSettings | null {
  try {
    const stored = window.localStorage.getItem(GENERATOR_STORAGE_KEY);
    return stored === null ? null : generatorSettingsFromSearch(stored);
  } catch {
    return null;
  }
}

function storeSettings(settings: GeneratorSettings): void {
  try {
    window.localStorage.setItem(GENERATOR_STORAGE_KEY, generatorSettingsToSearch(settings));
  } catch {
    // Storage may be unavailable (private mode); the URL still carries state.
  }
}

function synthParams(settings: GeneratorSettings, previewBucketCount: number): GenerateSynthParams {
  return {
    waveform: settings.waveform,
    sampleRateHz: settings.sampleRateHz,
    durationSeconds: settings.durationSeconds,
    amplitude: settings.amplitude,
    frequencyHz: settings.frequencyHz,
    dutyCycle: settings.dutyCycle,
    impulseIndex: settings.impulseIndex,
    stepIndex: settings.stepIndex,
    chirpFromHz: settings.chirpFromHz,
    chirpToHz: settings.chirpToHz,
    chirpLog: settings.chirpLog,
    tone2Hz: settings.tone2Hz,
    seed: settings.seed,
    previewBucketCount,
  };
}

function GeneratorPreview({
  minMax,
  ariaLabel,
}: {
  readonly minMax: Float32Array | null;
  readonly ariaLabel: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [widthPx, setWidthPx] = useState(640);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        setWidthPx(Math.max(1, Math.round(entry.contentRect.width)));
      }
    });
    observer.observe(host);
    setWidthPx(Math.max(1, Math.round(host.getBoundingClientRect().width)));
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas !== null && minMax !== null) {
      paintGeneratorPreview(canvas, minMax, widthPx, PREVIEW_HEIGHT_PX);
    }
  }, [minMax, widthPx]);

  return (
    <div ref={hostRef} dir="ltr">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        data-testid="generator.preview.canvas"
        style={{ height: `${PREVIEW_HEIGHT_PX}px` }}
        className="block w-full rounded bg-bg ring-1 ring-surface"
      />
    </div>
  );
}

export function GeneratorView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const loadSource = useSessionStore((state) => state.loadSource);
  const [searchParams, setSearchParams] = useSearchParams();
  const settings = useMemo(() => {
    const fromUrl = generatorSettingsFromSearch(`?${searchParams.toString()}`);
    if (searchParams.toString() === "") {
      const stored = readStoredSettings();
      if (stored !== null) {
        return stored;
      }
    }
    return fromUrl;
  }, [searchParams]);
  const [preview, setPreview] = useState<Float32Array | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const previewGenerationRef = useRef(0);

  function updateSettings(patch: Partial<GeneratorSettings>): void {
    const next = { ...settings, ...patch };
    const encoded = generatorSettingsToSearch(next);
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of new URLSearchParams(encoded)) {
      params.set(key, value);
    }
    setSearchParams(params, { replace: true });
    storeSettings(next);
  }

  useEffect(() => {
    const generation = previewGenerationRef.current + 1;
    previewGenerationRef.current = generation;
    setPreviewError(false);
    const timer = window.setTimeout(() => {
      const ticket = useSessionStore
        .getState()
        .deriveStandalone("generateSynth", synthParams(settings, PREVIEW_BUCKETS));
      ticket.outcome.then(
        (outcome) => {
          if (previewGenerationRef.current !== generation || "cancelled" in outcome) {
            return;
          }
          const payload = outcome.payload;
          if (payload === undefined) {
            setPreviewError(true);
            return;
          }
          setPreview(new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4));
        },
        () => {
          if (previewGenerationRef.current === generation) {
            setPreviewError(true);
          }
        },
      );
    }, 120);
    return () => {
      window.clearTimeout(timer);
    };
  }, [settings]);

  async function loadAsSource(): Promise<void> {
    setLoadingSource(true);
    setLoadError(false);
    try {
      const ticket = useSessionStore
        .getState()
        .deriveStandalone("generateSynth", synthParams(settings, 0));
      const outcome = await ticket.outcome;
      if ("cancelled" in outcome || outcome.payload === undefined) {
        setLoadError(true);
        return;
      }
      const payload = outcome.payload;
      const samples = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
      const waveformName = waveformLabels[settings.waveform];
      const result = loadSource(
        samples,
        settings.sampleRateHz,
        t("generator.sourceName", { waveform: waveformName }),
        "generated",
      );
      if (!result.ok) {
        setLoadError(true);
        return;
      }
      navigate("/tools/waveform");
    } catch {
      setLoadError(true);
    } finally {
      setLoadingSource(false);
    }
  }

  const waveformLabels: Record<SynthWaveform, string> = {
    sine: t("generator.waveform.sine"),
    square: t("generator.waveform.square"),
    sawtooth: t("generator.waveform.sawtooth"),
    triangle: t("generator.waveform.triangle"),
    impulse: t("generator.waveform.impulse"),
    step: t("generator.waveform.step"),
    whiteNoise: t("generator.waveform.whiteNoise"),
    pinkNoise: t("generator.waveform.pinkNoise"),
    chirp: t("generator.waveform.chirp"),
    twoTone: t("generator.waveform.twoTone"),
  };
  const sampleCount = Math.round(settings.sampleRateHz * settings.durationSeconds);
  const isTonal =
    settings.waveform === "sine" ||
    settings.waveform === "square" ||
    settings.waveform === "sawtooth" ||
    settings.waveform === "triangle" ||
    settings.waveform === "twoTone";

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold">{t("tool.generator.title")}</h2>

      <div className="grid grid-cols-1 gap-3 rounded border border-surface p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("generator.controls.waveform")}</span>
          <select
            value={settings.waveform}
            data-testid="generator.control.waveform"
            onChange={(event) => {
              const value = event.currentTarget.value;
              if ((GENERATOR_WAVEFORMS as readonly string[]).includes(value)) {
                updateSettings({ waveform: value as SynthWaveform });
              }
            }}
            className={INPUT_CLASSES}
          >
            {GENERATOR_WAVEFORMS.map((waveform) => (
              <option key={waveform} value={waveform}>
                {waveformLabels[waveform]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("generator.controls.sampleRate")}</span>
          <select
            value={settings.sampleRateHz}
            data-testid="generator.control.sampleRate"
            onChange={(event) =>
              updateSettings({ sampleRateHz: Number(event.currentTarget.value) })
            }
            className={INPUT_CLASSES}
          >
            {GENERATOR_SAMPLE_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate} Hz
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">{t("generator.controls.duration")}</span>
          <input
            type="number"
            min={0.05}
            max={GENERATOR_MAX_DURATION_S}
            step={0.05}
            value={settings.durationSeconds}
            data-testid="generator.control.duration"
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value) && value > 0 && value <= GENERATOR_MAX_DURATION_S) {
                updateSettings({ durationSeconds: value });
              }
            }}
            className={`${INPUT_CLASSES} tabular-nums`}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="flex items-center justify-between gap-2 font-medium">
            <span>{t("generator.controls.amplitude")}</span>
            <span dir="ltr" className="tabular-nums">
              {settings.amplitude.toFixed(2)}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={settings.amplitude}
            data-testid="generator.control.amplitude"
            onChange={(event) => updateSettings({ amplitude: Number(event.currentTarget.value) })}
            className={`w-full ${CONTROL_FOCUS_CLASSES}`}
          />
        </label>

        {isTonal ? (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">{t("generator.controls.frequency")}</span>
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
                  updateSettings({ frequencyHz: value });
                }
              }}
              className={`${INPUT_CLASSES} tabular-nums`}
            />
          </label>
        ) : null}

        {settings.waveform === "square" ? (
          <label className="flex flex-col gap-1 text-xs">
            <span className="flex items-center justify-between gap-2 font-medium">
              <span>{t("generator.controls.dutyCycle")}</span>
              <span dir="ltr" className="tabular-nums">
                {(settings.dutyCycle * 100).toFixed(0)} %
              </span>
            </span>
            <input
              type="range"
              min={0.05}
              max={0.95}
              step={0.05}
              value={settings.dutyCycle}
              data-testid="generator.control.dutyCycle"
              onChange={(event) => updateSettings({ dutyCycle: Number(event.currentTarget.value) })}
              className={`w-full ${CONTROL_FOCUS_CLASSES}`}
            />
          </label>
        ) : null}

        {settings.waveform === "impulse" ? (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">{t("generator.controls.impulseIndex")}</span>
            <input
              type="number"
              min={0}
              max={Math.max(0, sampleCount - 1)}
              step={1}
              value={settings.impulseIndex}
              data-testid="generator.control.impulseIndex"
              onChange={(event) =>
                updateSettings({ impulseIndex: Number(event.currentTarget.value) })
              }
              className={`${INPUT_CLASSES} tabular-nums`}
            />
          </label>
        ) : null}

        {settings.waveform === "step" ? (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">{t("generator.controls.stepIndex")}</span>
            <input
              type="number"
              min={0}
              max={Math.max(0, sampleCount - 1)}
              step={1}
              value={settings.stepIndex}
              data-testid="generator.control.stepIndex"
              onChange={(event) => updateSettings({ stepIndex: Number(event.currentTarget.value) })}
              className={`${INPUT_CLASSES} tabular-nums`}
            />
          </label>
        ) : null}

        {settings.waveform === "chirp" ? (
          <>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t("generator.controls.chirpFrom")}</span>
              <input
                type="number"
                min={1}
                max={48000}
                step={1}
                value={settings.chirpFromHz}
                data-testid="generator.control.chirpFrom"
                onChange={(event) =>
                  updateSettings({ chirpFromHz: Number(event.currentTarget.value) })
                }
                className={`${INPUT_CLASSES} tabular-nums`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{t("generator.controls.chirpTo")}</span>
              <input
                type="number"
                min={1}
                max={48000}
                step={1}
                value={settings.chirpToHz}
                data-testid="generator.control.chirpTo"
                onChange={(event) =>
                  updateSettings({ chirpToHz: Number(event.currentTarget.value) })
                }
                className={`${INPUT_CLASSES} tabular-nums`}
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={settings.chirpLog}
                data-testid="generator.control.chirpLog"
                onChange={(event) => updateSettings({ chirpLog: event.currentTarget.checked })}
                className={CONTROL_FOCUS_CLASSES}
              />
              <span className="font-medium">{t("generator.controls.chirpLog")}</span>
            </label>
          </>
        ) : null}

        {settings.waveform === "twoTone" ? (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">{t("generator.controls.tone2")}</span>
            <input
              type="number"
              min={1}
              max={48000}
              step={1}
              value={settings.tone2Hz}
              data-testid="generator.control.tone2"
              onChange={(event) => updateSettings({ tone2Hz: Number(event.currentTarget.value) })}
              className={`${INPUT_CLASSES} tabular-nums`}
            />
          </label>
        ) : null}

        {settings.waveform === "whiteNoise" || settings.waveform === "pinkNoise" ? (
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium">{t("generator.controls.seed")}</span>
            <input
              type="number"
              min={0}
              max={2 ** 31 - 1}
              step={1}
              value={settings.seed}
              data-testid="generator.control.seed"
              onChange={(event) => updateSettings({ seed: Number(event.currentTarget.value) })}
              className={`${INPUT_CLASSES} tabular-nums`}
            />
          </label>
        ) : null}
      </div>

      <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <div className="flex items-center gap-1">
          <dt>{t("generator.meta.samples")}</dt>
          <dd dir="ltr" data-testid="generator.meta.samples" className="tabular-nums">
            {sampleCount}
          </dd>
        </div>
        <div className="flex items-center gap-1">
          <dt>{t("generator.meta.duration")}</dt>
          <dd dir="ltr" data-testid="generator.meta.duration" className="tabular-nums">
            {formatS(settings.durationSeconds)}
          </dd>
        </div>
      </dl>

      {previewError ? (
        <p role="alert" data-testid="generator.preview.error" className="text-sm text-muted">
          {t("generator.preview.error")}
        </p>
      ) : preview === null ? (
        <p data-testid="generator.preview.loading" className="text-sm text-muted">
          {t("generator.preview.loading")}
        </p>
      ) : (
        <GeneratorPreview minMax={preview} ariaLabel={t("generator.preview.label")} />
      )}

      <div className="flex items-center gap-2">
        <Button
          data-testid="generator.load"
          disabled={loadingSource}
          onClick={() => {
            void loadAsSource();
          }}
        >
          {loadingSource ? t("generator.loadingSource") : t("generator.load")}
        </Button>
        {loadError ? (
          <p role="alert" data-testid="generator.load.error" className="text-sm text-muted">
            {t("generator.error")}
          </p>
        ) : null}
      </div>
      <p className="text-xs text-muted">{t("generator.preview.hint")}</p>
    </section>
  );
}
