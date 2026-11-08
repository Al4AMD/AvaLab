/**
 * F16 student lab-report export. The report is a self-contained HTML file so
 * it opens offline and prints to PDF through the browser. No audio crosses
 * the page boundary: only the current source metadata, visible control
 * values, measured metrics, visible canvas snapshots and theory citations are
 * written. Share URLs never contain user audio (F16).
 */
import { sanitizeFilename } from "../../lib/download";

export type LabReportParameter = {
  readonly label: string;
  readonly value: string;
};

export type LabReportMetric = {
  readonly group: string;
  readonly label: string;
  readonly value: string;
};

export type LabReportFigure = {
  readonly label: string;
  readonly dataUrl: string;
};

export type LabReportTheorySection = {
  readonly heading: string;
  readonly body: string;
  readonly formula?: string;
};

export type LabReportInput = {
  readonly title: string;
  readonly toolTitle: string;
  readonly generatedAt: string;
  readonly url: string;
  readonly lang: string;
  readonly dir: "ltr" | "rtl";
  readonly source: {
    readonly name: string;
    readonly durationS: number;
    readonly sampleRateHz: number;
    readonly channelCount: number;
    readonly processedLabel: string | null;
    readonly processedDurationS: number | null;
  };
  readonly parameters: readonly LabReportParameter[];
  readonly metrics: readonly LabReportMetric[];
  readonly metricNote: string | null;
  readonly figures: readonly LabReportFigure[];
  readonly labels: {
    readonly source: string;
    readonly parameters: string;
    readonly setting: string;
    readonly value: string;
    readonly metrics: string;
    readonly lane: string;
    readonly metric: string;
    readonly figures: string;
    readonly notice: string;
    readonly print: string;
    readonly name: string;
    readonly duration: string;
    readonly sampleRate: string;
    readonly channels: string;
    readonly processedLane: string;
    readonly processedDuration: string;
    readonly figure: string;
  };
  readonly theory: {
    readonly title: string;
    readonly sections: readonly LabReportTheorySection[];
  } | null;
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function tableRows(rows: readonly { label: string; value: string }[]): string {
  return rows
    .map(
      (row) =>
        `<tr><th scope="row">${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`,
    )
    .join("");
}

function metricRows(rows: readonly LabReportMetric[]): string {
  return rows
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.group)}</td><td>${escapeHtml(row.label)}</td><td dir="ltr">${escapeHtml(row.value)}</td></tr>`,
    )
    .join("");
}

function figureCards(figures: readonly LabReportFigure[]): string {
  return figures
    .map(
      (figure) =>
        `<figure><img src="${escapeHtml(figure.dataUrl)}" alt="${escapeHtml(figure.label)}"><figcaption>${escapeHtml(figure.label)}</figcaption></figure>`,
    )
    .join("");
}

function theoryBlocks(theory: LabReportInput["theory"]): string {
  if (theory === null) {
    return "";
  }
  const sections = theory.sections
    .map(
      (section) =>
        `<section><h3>${escapeHtml(section.heading)}</h3>${
          section.formula === undefined
            ? ""
            : `<p class="formula" dir="ltr">${escapeHtml(section.formula)}</p>`
        }<p>${escapeHtml(section.body)}</p></section>`,
    )
    .join("");
  return `<section><h2>${escapeHtml(theory.title)}</h2>${sections}</section>`;
}

/** Build the standalone report document. Every interpolation is escaped. */
export function buildLabReportHtml(input: LabReportInput): string {
  const sourceRows: LabReportParameter[] = [
    { label: input.labels.name, value: input.source.name },
    { label: input.labels.duration, value: `${input.source.durationS.toFixed(3)} s` },
    { label: input.labels.sampleRate, value: `${input.source.sampleRateHz} Hz` },
    { label: input.labels.channels, value: String(input.source.channelCount) },
  ];
  if (input.source.processedLabel !== null) {
    sourceRows.push({ label: input.labels.processedLane, value: input.source.processedLabel });
  }
  if (input.source.processedDurationS !== null) {
    sourceRows.push({
      label: input.labels.processedDuration,
      value: `${input.source.processedDurationS.toFixed(3)} s`,
    });
  }

  return `<!doctype html>
<html lang="${escapeHtml(input.lang)}" dir="${input.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>
:root { color-scheme: light; }
body { max-width: 980px; margin: 0 auto; padding: 2rem 1.25rem 4rem; color: #17202a; background: #fff; font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { margin: 0.2rem 0 0.4rem; font-size: 1.9rem; }
h2 { margin-top: 2rem; padding-bottom: 0.25rem; border-bottom: 1px solid #ccd4dc; font-size: 1.25rem; }
h3 { margin: 1.2rem 0 0.3rem; font-size: 1rem; }
.brand { color: #0f766e; font-weight: 700; letter-spacing: 0.04em; }
.meta { color: #5b6773; font-size: 0.85rem; }
table { width: 100%; border-collapse: collapse; margin: 0.75rem 0; }
th, td { padding: 0.4rem 0.55rem; border: 1px solid #d7dee5; text-align: start; vertical-align: top; }
thead th { background: #f1f5f8; }
.formula { padding: 0.5rem 0.7rem; background: #f1f5f8; border-radius: 4px; font-family: ui-monospace, monospace; }
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; }
figure { margin: 0; }
img { width: 100%; height: auto; border: 1px solid #d7dee5; border-radius: 4px; }
figcaption { color: #5b6773; font-size: 0.8rem; margin-top: 0.25rem; }
.notice { color: #5b6773; font-size: 0.8rem; margin-top: 2rem; }
button { position: fixed; inset-block-start: 1rem; inset-inline-end: 1rem; padding: 0.5rem 0.9rem; border: 1px solid #0f766e; border-radius: 4px; background: #0f766e; color: #fff; font: inherit; cursor: pointer; }
@media print { button { display: none; } body { padding: 0; } h2 { break-after: avoid; } figure, section { break-inside: avoid; } }
</style>
</head>
<body>
<button id="avalab-print" type="button">${escapeHtml(input.labels.print)}</button>
<header>
<p class="brand">AvaLab</p>
<h1>${escapeHtml(input.title)}</h1>
<p class="meta">${escapeHtml(input.toolTitle)} · ${escapeHtml(input.generatedAt)} · <span dir="ltr">${escapeHtml(input.url)}</span></p>
</header>
<section><h2>${escapeHtml(input.labels.source)}</h2><table><tbody>${tableRows(sourceRows)}</tbody></table></section>
${
  input.parameters.length === 0
    ? ""
    : `<section><h2>${escapeHtml(input.labels.parameters)}</h2><table><thead><tr><th>${escapeHtml(input.labels.setting)}</th><th>${escapeHtml(input.labels.value)}</th></tr></thead><tbody>${tableRows(input.parameters)}</tbody></table></section>`
}
<section><h2>${escapeHtml(input.labels.metrics)}</h2>${
    input.metricNote === null ? "" : `<p>${escapeHtml(input.metricNote)}</p>`
  }${
    input.metrics.length === 0
      ? ""
      : `<table><thead><tr><th>${escapeHtml(input.labels.lane)}</th><th>${escapeHtml(input.labels.metric)}</th><th>${escapeHtml(input.labels.value)}</th></tr></thead><tbody>${metricRows(input.metrics)}</tbody></table>`
  }</section>
${
  input.figures.length === 0
    ? ""
    : `<section><h2>${escapeHtml(input.labels.figures)}</h2><div class="figures">${figureCards(input.figures)}</div></section>`
}
${theoryBlocks(input.theory)}
<p class="notice">${escapeHtml(input.labels.notice)}</p>
<script>document.getElementById("avalab-print")?.addEventListener("click", function () { window.print(); });</script>
</body>
</html>`;
}

/** Copy the visible parameter controls of the current tool. File inputs and
 * hidden/password fields never enter the report. */
export function collectPageParameters(scope: ParentNode, maxRows = 40): LabReportParameter[] {
  const rows: LabReportParameter[] = [];
  const seen = new Set<string>();
  const controls = scope.querySelectorAll<HTMLElement>(
    'input:not([type="file"]):not([type="password"]):not([type="hidden"]), select, textarea',
  );
  for (const control of controls) {
    if (rows.length >= maxRows || control.getClientRects().length === 0) {
      continue;
    }
    const label =
      control.getAttribute("aria-label") ??
      control.closest("label")?.textContent?.trim().replace(/\s+/g, " ") ??
      control.getAttribute("name") ??
      "";
    if (label === "" || seen.has(label)) {
      continue;
    }
    seen.add(label);
    if (control instanceof HTMLInputElement) {
      if (control.type === "checkbox" || control.type === "radio") {
        if (!control.checked) {
          continue;
        }
        rows.push({ label, value: "✓" });
      } else {
        rows.push({ label, value: control.value });
      }
    } else if (control instanceof HTMLSelectElement) {
      rows.push({ label, value: control.selectedOptions[0]?.text ?? control.value });
    } else if (control instanceof HTMLTextAreaElement) {
      rows.push({ label, value: control.value });
    }
  }
  return rows;
}

/** Snapshot visible canvases in reading order. Empty or zero-size canvases
 * are skipped so a report never shows a blank chart. */
export function collectCanvasFigures(
  scope: ParentNode,
  maxFigures = 8,
  fallbackFigureLabel: (index: number) => string = (index) => `Figure ${index}`,
): LabReportFigure[] {
  const figures: LabReportFigure[] = [];
  for (const canvas of scope.querySelectorAll("canvas")) {
    if (figures.length >= maxFigures || canvas.width <= 0 || canvas.height <= 0) {
      continue;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      continue;
    }
    let dataUrl: string;
    try {
      dataUrl = canvas.toDataURL("image/png");
    } catch {
      continue;
    }
    if (dataUrl === "data:,") {
      continue;
    }
    const label =
      canvas.getAttribute("aria-label") ??
      canvas.closest("figure")?.querySelector("figcaption")?.textContent?.trim() ??
      canvas.dataset.testid ??
      fallbackFigureLabel(figures.length + 1);
    figures.push({ label, dataUrl });
  }
  return figures;
}

/** Trigger a download for the generated report. */
export function downloadLabReportHtml(html: string, filename: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = sanitizeFilename(filename, "avalab-lab-report.html");
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
