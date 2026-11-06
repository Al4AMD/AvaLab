import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  BenchmarkPanel,
  STFT_BENCHMARK_FFT_LENGTH,
  STFT_BENCHMARK_HOP,
  stftBenchmarkFrameCount,
} from "./benchmarkPanel";
import { ButterflyPanel } from "./butterflyPanel";

let t: typeof import("../../i18n").default.t;

beforeAll(async () => {
  vi.stubGlobal("document", { documentElement: { lang: "", dir: "" }, title: "" });
  const i18n = await import("../../i18n");
  t = i18n.default.t.bind(i18n.default);
});

describe("F08 benchmark and butterfly panels", () => {
  it("renders the benchmark controls and idle status", () => {
    const markup = renderToStaticMarkup(<BenchmarkPanel startSample={0} endSample={4096} />);
    expect(markup).toContain(t("fftview.benchmark.title"));
    expect(markup).toContain('data-testid="fftview.benchmark.run"');
    expect(markup).toContain('data-testid="fftview.benchmark.stftRun"');
    expect(markup).toContain(t("fftview.benchmark.status.idle"));
    expect(markup).not.toContain("NaN");
  });

  it("computes full-file STFT frame counts without inventing padding", () => {
    expect(stftBenchmarkFrameCount(STFT_BENCHMARK_FFT_LENGTH - 1)).toBe(0);
    expect(stftBenchmarkFrameCount(STFT_BENCHMARK_FFT_LENGTH)).toBe(1);
    expect(stftBenchmarkFrameCount(STFT_BENCHMARK_FFT_LENGTH + 2 * STFT_BENCHMARK_HOP)).toBe(3);
  });

  it("renders the butterfly size selector with N=8 and N=16", () => {
    const markup = renderToStaticMarkup(<ButterflyPanel startSample={0} />);
    expect(markup).toContain(t("fftview.butterfly.title"));
    expect(markup).toContain(">N = 8<");
    expect(markup).toContain(">N = 16<");
    expect(markup).toContain('data-testid="fftview.butterfly.size"');
  });
});
