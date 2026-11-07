import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/button";
import type { FftBenchmarkResult } from "../../session/ops";
import { useSessionStore } from "../../session/store";

export const STFT_BENCHMARK_FFT_LENGTH = 1024;
export const STFT_BENCHMARK_HOP = 256;
export const STFT_BENCHMARK_CHUNK_FRAMES = 256;
export const FFT_BENCHMARK_SIZES = [256, 1024, 4096, 16384] as const;

function formatMs(milliseconds: number): string {
  return Number.isFinite(milliseconds) ? `${milliseconds.toFixed(3)} ms` : "—";
}

type BenchmarkRow = Omit<FftBenchmarkResult["meta"], "iterations">;

export function stftBenchmarkFrameCount(sampleCount: number): number {
  if (!Number.isFinite(sampleCount) || sampleCount < STFT_BENCHMARK_FFT_LENGTH) {
    return 0;
  }
  return Math.floor((sampleCount - STFT_BENCHMARK_FFT_LENGTH) / STFT_BENCHMARK_HOP) + 1;
}

export function BenchmarkPanel({
  startSample,
  endSample,
}: {
  readonly startSample: number;
  readonly endSample: number;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<readonly BenchmarkRow[]>([]);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "cancelled" | "error">("idle");
  const [stftFramesDone, setStftFramesDone] = useState(0);
  const [stftFramesTotal, setStftFramesTotal] = useState(0);
  const [stftElapsedMs, setStftElapsedMs] = useState(0);
  const cancelRef = useRef(false);
  const activeKeyRef = useRef<string | null>(null);
  const totalFrames = stftBenchmarkFrameCount(Math.max(0, endSample - startSample));
  const busy = status === "running";

  async function runSizeBenchmark(): Promise<void> {
    setStatus("running");
    cancelRef.current = false;
    setRows([]);
    try {
      const results: BenchmarkRow[] = [];
      for (const fftLengthSamples of FFT_BENCHMARK_SIZES) {
        if (cancelRef.current) {
          setStatus("cancelled");
          return;
        }
        const ticket = useSessionStore
          .getState()
          .deriveStandalone("fftBenchmark", { fftLengthSamples, iterations: 10 });
        const outcome = await ticket.outcome;
        if (cancelRef.current) {
          setStatus("cancelled");
          return;
        }
        if ("cancelled" in outcome) {
          setStatus("cancelled");
          return;
        }
        results.push(outcome.meta);
        setRows([...results]);
      }
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  async function runStftBenchmark(): Promise<void> {
    if (totalFrames === 0) {
      return;
    }
    setStatus("running");
    cancelRef.current = false;
    setStftFramesDone(0);
    setStftFramesTotal(totalFrames);
    setStftElapsedMs(0);
    let framesDone = 0;
    let elapsedMs = 0;
    try {
      for (
        let frameStart = 0;
        frameStart < totalFrames;
        frameStart += STFT_BENCHMARK_CHUNK_FRAMES
      ) {
        if (cancelRef.current) {
          setStatus("cancelled");
          return;
        }
        const frameCount = Math.min(STFT_BENCHMARK_CHUNK_FRAMES, totalFrames - frameStart);
        const chunkStart = startSample + frameStart * STFT_BENCHMARK_HOP;
        const chunkEnd =
          chunkStart + (frameCount - 1) * STFT_BENCHMARK_HOP + STFT_BENCHMARK_FFT_LENGTH;
        const ticket = useSessionStore.getState().deriveWithSourceSlice(
          "stftBenchmark",
          {
            fftLengthSamples: STFT_BENCHMARK_FFT_LENGTH,
            hopSamples: STFT_BENCHMARK_HOP,
            startSample: chunkStart,
            frameCount,
          },
          chunkStart,
          chunkEnd,
        );
        activeKeyRef.current = ticket.key;
        const outcome = await ticket.outcome;
        activeKeyRef.current = null;
        if (cancelRef.current || "cancelled" in outcome) {
          setStatus("cancelled");
          return;
        }
        framesDone += outcome.meta.framesProcessed;
        elapsedMs += outcome.meta.elapsedMs;
        setStftFramesDone(framesDone);
        setStftElapsedMs(elapsedMs);
      }
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  function cancel(): void {
    cancelRef.current = true;
    const key = activeKeyRef.current;
    if (key !== null) {
      useSessionStore.getState().cancel(key);
    }
    setStatus("cancelled");
  }

  return (
    <section className="flex flex-col gap-3 rounded border border-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("fftview.benchmark.title")}</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => void runSizeBenchmark()}
            disabled={busy}
            data-testid="fftview.benchmark.run"
          >
            {t("fftview.benchmark.run")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void runStftBenchmark()}
            disabled={busy || totalFrames === 0}
            data-testid="fftview.benchmark.stftRun"
          >
            {t("fftview.benchmark.stftRun")}
          </Button>
          {busy ? (
            <Button
              size="sm"
              variant="outline"
              onClick={cancel}
              data-testid="fftview.benchmark.cancel"
            >
              {t("fftview.benchmark.cancel")}
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted">{t("fftview.benchmark.note")}</p>
      {rows.length > 0 ? (
        <table
          className="w-full max-w-2xl text-xs tabular-nums"
          data-testid="fftview.benchmark.table"
        >
          <thead>
            <tr className="text-muted">
              <th className="text-start font-medium">{t("fftview.benchmark.size")}</th>
              <th className="text-start font-medium">{t("fftview.benchmark.ours")}</th>
              <th className="text-start font-medium">{t("fftview.benchmark.library")}</th>
              <th className="text-start font-medium">{t("fftview.benchmark.ratio")}</th>
              <th className="text-start font-medium">{t("fftview.benchmark.error")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.fftLengthSamples}
                data-testid={`fftview.benchmark.row.${row.fftLengthSamples}`}
              >
                <td dir="ltr">{String(row.fftLengthSamples)}</td>
                <td dir="ltr">{formatMs(row.oursMedianMs)}</td>
                <td dir="ltr">{formatMs(row.libraryMedianMs)}</td>
                <td dir="ltr">{row.speedRatio.toFixed(2)}×</td>
                <td dir="ltr">{row.maxAbsError.toExponential(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {stftFramesTotal > 0 ? (
        <p dir="ltr" className="text-xs text-muted" data-testid="fftview.benchmark.stftProgress">
          {stftFramesDone}/{stftFramesTotal} · {formatMs(stftElapsedMs)}
        </p>
      ) : null}
      <p role="status" className="text-xs text-muted" data-testid="fftview.benchmark.status">
        {t(`fftview.benchmark.status.${status}`)}
      </p>
    </section>
  );
}
