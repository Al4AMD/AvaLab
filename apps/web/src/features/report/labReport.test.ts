import { describe, expect, it } from "vitest";

import { buildLabReportHtml, escapeHtml, type LabReportInput } from "./labReport";

function input(overrides: Partial<LabReportInput> = {}): LabReportInput {
  return {
    title: "AvaLab lab report",
    toolTitle: "Spectrogram",
    generatedAt: "2026-11-08 00:00:00 UTC",
    url: "https://example.test/tools/spectrogram?demo=chirp",
    lang: "en",
    dir: "ltr",
    source: {
      name: "chirp.wav",
      durationS: 5,
      sampleRateHz: 48_000,
      channelCount: 1,
      processedLabel: null,
      processedDurationS: null,
    },
    parameters: [{ label: "Window", value: "Hann" }],
    metrics: [{ group: "Mono", label: "SNR", value: "12.00 dB" }],
    metricNote: null,
    figures: [{ label: "Spectrogram", dataUrl: "data:image/png;base64,AAAA" }],
    labels: {
      source: "Source",
      parameters: "Parameters",
      setting: "Setting",
      value: "Value",
      metrics: "Metrics",
      lane: "Lane",
      metric: "Metric",
      figures: "Figures",
      notice: "No audio is embedded.",
      print: "Print / Save as PDF",
      name: "Name",
      duration: "Duration",
      sampleRate: "Sample rate",
      channels: "Channels",
      processedLane: "Processed lane",
      processedDuration: "Processed duration",
      figure: "Figure",
    },
    theory: {
      title: "Spectrogram theory",
      sections: [{ heading: "STFT", body: "Frames and windows.", formula: "X[k]" }],
    },
    ...overrides,
  };
}

describe("buildLabReportHtml", () => {
  it("escapes every interpolated value and includes the report sections", () => {
    const html = buildLabReportHtml(
      input({
        title: '<script>alert("x")</script>',
        source: {
          ...input().source,
          name: '<img src=x onerror="alert(1)">.wav',
        },
      }),
    );
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;.wav");
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("<h2>Source</h2>");
    expect(html).toContain("<h2>Parameters</h2>");
    expect(html).toContain("<h2>Metrics</h2>");
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain("<h2>Spectrogram theory</h2>");
    expect(html).toContain("X[k]");
  });

  it("omits empty optional sections and keeps the print action", () => {
    const html = buildLabReportHtml(
      input({ parameters: [], metrics: [], figures: [], theory: null }),
    );
    expect(html).not.toContain("<h2>Parameters</h2>");
    expect(html).not.toContain("<h2>Figures</h2>");
    expect(html).toContain('id="avalab-print"');
  });
});

describe("escapeHtml", () => {
  it("escapes all five HTML metacharacters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
