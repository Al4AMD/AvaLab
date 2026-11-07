/** Rejection from installing an AI result into the processed lane. */
export class ProcessedInstallError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`store rejected AI result (${code})`);
    this.name = "ProcessedInstallError";
    this.code = code;
  }
}

/** Translate a stale-source rejection; keep the tab's own failure key otherwise. */
export function processedInstallErrorKey(error: unknown, fallbackKey: string): string {
  return error instanceof ProcessedInstallError && error.code === "staleSource"
    ? "processed.error.staleSource"
    : fallbackKey;
}
