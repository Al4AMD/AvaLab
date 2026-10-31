/**
 * Locale-neutral technical number formatting (AGENTS §6): Latin digits and
 * units, no `toLocaleString`, so a language switch never changes a readout.
 */

export function formatS(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return "—";
  }
  if (Math.abs(seconds) < 1) {
    return `${(seconds * 1000).toFixed(1)} ms`;
  }
  return `${seconds.toFixed(3)} s`;
}

export function formatHz(frequencyHz: number): string {
  if (!Number.isFinite(frequencyHz)) {
    return "—";
  }
  if (Math.abs(frequencyHz) < 1000) {
    return `${frequencyHz.toFixed(1)} Hz`;
  }
  return `${(frequencyHz / 1000).toFixed(2)} kHz`;
}

export function formatDb(decibels: number): string {
  if (!Number.isFinite(decibels)) {
    return "—";
  }
  return `${decibels.toFixed(1)} dB`;
}
