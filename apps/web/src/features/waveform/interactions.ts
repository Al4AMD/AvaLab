/** Sample-domain window math for the waveform tool (F02). Pure functions so
 * pan/zoom/URL behaviour is testable without a DOM or a canvas. */

export type SampleWindow = { startSample: number; endSample: number };

export function clampWindow(window: SampleWindow, sampleCount: number): SampleWindow {
  if (sampleCount <= 0) {
    return { startSample: 0, endSample: 0 };
  }
  const startSample = Math.max(0, Math.min(Math.round(window.startSample), sampleCount - 1));
  const endSample = Math.max(startSample + 1, Math.min(Math.round(window.endSample), sampleCount));
  return { startSample, endSample };
}

export function zoomWindow(
  window: SampleWindow,
  sampleCount: number,
  factor: number,
  anchorSample: number,
): SampleWindow {
  const span = window.endSample - window.startSample;
  if (span <= 0 || sampleCount <= 0) {
    return { startSample: 0, endSample: sampleCount };
  }
  const newSpan = Math.max(1, Math.round(span * factor));
  const anchor = Math.max(window.startSample, Math.min(anchorSample, window.endSample));
  const anchorFraction = (anchor - window.startSample) / span;
  const startSample = Math.floor(anchor - anchorFraction * newSpan);
  return clampWindow({ startSample, endSample: startSample + newSpan }, sampleCount);
}

export function panWindow(
  window: SampleWindow,
  sampleCount: number,
  fractionOfSpan: number,
): SampleWindow {
  const span = window.endSample - window.startSample;
  const maxStart = Math.max(0, sampleCount - span);
  const startSample = Math.max(
    0,
    Math.min(Math.round(window.startSample + span * fractionOfSpan), maxStart),
  );
  return { startSample, endSample: Math.min(sampleCount, startSample + span) };
}

export function windowToSearch(window: SampleWindow): string {
  const params = new URLSearchParams({
    t: `${window.startSample}..${window.endSample}`,
  });
  return params.toString();
}

export function windowFromSearch(search: string, sampleCount: number): SampleWindow {
  const raw = new URLSearchParams(search).get("t");
  if (raw === null) {
    return { startSample: 0, endSample: sampleCount };
  }
  const match = /^(\d+)\.\.(\d+)$/.exec(raw);
  if (match === null) {
    return { startSample: 0, endSample: sampleCount };
  }
  const startSample = Number(match[1]);
  const endSample = Number(match[2]);
  if (!Number.isSafeInteger(startSample) || !Number.isSafeInteger(endSample)) {
    return { startSample: 0, endSample: sampleCount };
  }
  if (startSample >= endSample || startSample >= sampleCount) {
    return { startSample: 0, endSample: sampleCount };
  }
  return clampWindow({ startSample, endSample }, sampleCount);
}
