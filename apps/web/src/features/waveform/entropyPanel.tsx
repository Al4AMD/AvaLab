import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Histogram } from "../../components/Histogram";
import { WAVEFORM_ENTROPY_DISPLAY_BINS, type WaveformEntropyResult } from "../../session/ops";
import { useSessionStore } from "../../session/store";

const ENTROPY_DEBOUNCE_MS = 150;

type EntropyBits = 8 | 12 | 16;

function isEntropyBits(value: number): value is EntropyBits {
  return value === 8 || value === 12 || value === 16;
}

/** Amplitude-entropy readout for the current waveform selection. Entropy is
 * computed on the exact 2^N quantized alphabet in the worker; the canvas only
 * shows a 256-bin aggregation for display. */
export function EntropyPanel() {
  const { t } = useTranslation();
  const selection = useSessionStore((state) => state.selection);
  const derived = useSessionStore((state) => state.derived);
  const inputHash = useSessionStore((state) => state.inputHash);
  const [bitsPerSample, setBitsPerSample] = useState<EntropyBits>(8);
  const [key, setKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const hasSelection = selection.endSample > selection.startSample;

  useEffect(() => {
    if (!hasSelection || inputHash === null) {
      setKey(null);
      setPending(false);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setPending(true);
    setFailed(false);
    const timer = window.setTimeout(() => {
      const ticket = useSessionStore.getState().deriveWithSourceSlice(
        "waveformEntropy",
        {
          bitsPerSample,
          startSample: selection.startSample,
          endSample: selection.endSample,
        },
        selection.startSample,
        selection.endSample,
      );
      setKey(ticket.key);
      setPending(false);
      ticket.outcome.catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    }, ENTROPY_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inputHash, selection.startSample, selection.endSample, bitsPerSample, hasSelection]);

  const entry = key === null ? undefined : derived.get(key);
  const result = entry?.result as WaveformEntropyResult | undefined;
  const histogram = useMemo(() => {
    const payload = result?.payload;
    if (payload === undefined || payload.byteOffset % 4 !== 0) {
      return null;
    }
    return new Uint32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4);
  }, [result]);

  const loading = pending || (key !== null && result === undefined && !failed);
  const percent =
    result === undefined
      ? null
      : (result.meta.entropyBitsPerSample / result.meta.maxEntropyBitsPerSample) * 100;

  return (
    <section
      aria-labelledby="waveform-entropy-title"
      data-testid="waveform.entropy"
      aria-busy={loading}
      className="flex flex-col gap-3 rounded-lg border border-surface bg-bg/40 p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 id="waveform-entropy-title" className="text-sm font-semibold">
            {t("waveform.entropy.title")}
          </h3>
          <p className="text-xs text-muted">{t("waveform.entropy.description")}</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          {t("waveform.entropy.bits.label")}
          <select
            value={bitsPerSample}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (isEntropyBits(next)) {
                setBitsPerSample(next);
              }
            }}
            data-testid="waveform.entropy.bits"
            className="rounded border border-surface bg-bg px-2 py-1 font-mono text-xs text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {([8, 12, 16] as const).map((bits) => (
              <option key={bits} value={bits}>
                {t("waveform.entropy.bits.option", { bits })}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!hasSelection ? (
        <p data-testid="waveform.entropy.empty" className="text-sm text-muted">
          {t("waveform.entropy.empty")}
        </p>
      ) : failed ? (
        <p role="alert" data-testid="waveform.entropy.error" className="text-sm text-danger">
          {t("waveform.entropy.error")}
        </p>
      ) : loading || histogram === null || result === undefined ? (
        <p data-testid="waveform.entropy.loading" className="text-sm text-muted">
          {t("waveform.entropy.loading")}
        </p>
      ) : (
        <>
          <Histogram
            histogram={histogram}
            ariaLabel={t("waveform.entropy.histogramAria")}
            testId="waveform.entropy.histogram"
          />
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <div>
              <div className="text-xs text-muted">{t("waveform.entropy.samples")}</div>
              <div dir="ltr" data-testid="waveform.entropy.samples" className="font-mono text-sm">
                {result.meta.sampleCount.toLocaleString("en-US")}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">{t("waveform.entropy.entropy")}</div>
              <div dir="ltr" data-testid="waveform.entropy.entropy" className="font-mono text-sm">
                {result.meta.entropyBitsPerSample.toFixed(2)} {t("waveform.entropy.unit")}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">{t("waveform.entropy.maxEntropy")}</div>
              <div
                dir="ltr"
                data-testid="waveform.entropy.maxEntropy"
                className="font-mono text-sm"
              >
                {result.meta.maxEntropyBitsPerSample} {t("waveform.entropy.unit")}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">{t("waveform.entropy.ratio")}</div>
              <div dir="ltr" data-testid="waveform.entropy.ratio" className="font-mono text-sm">
                {percent?.toFixed(1) ?? "—"}%
              </div>
            </div>
          </div>
          <p dir="ltr" className="font-mono text-xs text-muted">
            {t("waveform.entropy.formula")}
          </p>
          <p className="text-xs text-muted">{t("waveform.entropy.caveat")}</p>
        </>
      )}
      <p className="text-xs text-muted">
        {t("waveform.entropy.binsNote", {
          bins: WAVEFORM_ENTROPY_DISPLAY_BINS,
        })}
      </p>
    </section>
  );
}
