/**
 * Offline decode lane (F01, Wave-2 Plan 02 Task 2) — spec §2.4: when the
 * backend is unreachable (or by explicit choice) files decode in the BROWSER
 * (whatever the platform's `decodeAudioData` accepts) and the bundled demo
 * clips load from the static origin. This lane makes NO API call, so it
 * never writes the `backendOnline` flag — flips stay with the ingest lane's
 * mark* evidence (plan Review Focus 3).
 *
 * Caps are the session store's `loadSource` guards as the ONLY backstop
 * (plan Review Focus 1): out-of-cap samples (≤ 96 kHz, ≤ 300 s, finite)
 * REJECT with the store's structured code — nothing here truncates. The
 * codes map to translated `input.error.*` exactly like Task 1's lane (same
 * store contract, same key scheme).
 *
 * Decoding reuses Task 1's injectable seam — the default IS ingest.ts's
 * `browserDecodeWav` (no second decode implementation; node tests inject a
 * fake, the browser path is proven by e2e). Demo clips share the same
 * decode → downmix → guarded-load tail, differing only in the bytes' source
 * and the `sourceKind` ("demoClip" vs "offlineBrowser" — lane honesty, plan
 * Review Focus 3).
 */
import type { SessionStore, SourceKind } from "../../session/store";
import { useSessionStore } from "../../session/store";
import type { LoadedSource } from "./ingest";
import { browserDecodeWav, type DecodedAudio, type DecodeWav, monoDownmix } from "./ingest";

/**
 * Failure kinds of the offline lane. An UNREADABLE file (the read throws)
 * lands in `decodeFailed` too — bytes that cannot be read cannot be decoded;
 * the cause carries the original error.
 */
export type OfflineFailureKind = "decodeFailed" | "storeCode" | "demoUnavailable";

/** The structured failure an `OfflineError` carries; `messageKey` is the
 * i18n key the UI renders at render time (a locale switch re-renders
 * correctly). */
export type OfflineFailure = {
  readonly kind: OfflineFailureKind;
  /** Raw store-guard code for the storeCode kind; undefined otherwise. */
  readonly code: string | undefined;
  readonly messageKey: string;
};

/** Rejection of the offline/demo lane: typed, code-bearing, never a
 * swallowed error. */
export class OfflineError extends Error {
  readonly kind: OfflineFailureKind;
  readonly code: string | undefined;
  readonly messageKey: string;

  constructor(failure: OfflineFailure, options?: { cause?: unknown }) {
    super(failure.messageKey, options);
    this.name = "OfflineError";
    this.kind = failure.kind;
    this.code = failure.code;
    this.messageKey = failure.messageKey;
  }
}

function decodeFailedError(cause: unknown): OfflineError {
  return new OfflineError(
    { kind: "decodeFailed", code: undefined, messageKey: "input.error.decode_failed" },
    { cause },
  );
}

function demoUnavailableError(cause: unknown): OfflineError {
  return new OfflineError(
    { kind: "demoUnavailable", code: undefined, messageKey: "input.error.demoUnavailable" },
    { cause },
  );
}

/** Narrow store seam (the app singleton and test stores satisfy it
 * structurally). */
export type OfflineStore = {
  getState(): Pick<SessionStore, "loadSource" | "original">;
};

/** Options of `loadOfflineFile` / `loadDemoClip`: seams default to the app
 * singletons; tests inject their own (Task 1's injection pattern). */
export type OfflineOptions = {
  readonly decodeWav?: DecodeWav;
  readonly store?: OfflineStore;
};

/**
 * The shared decode → mono downmix → guarded-load tail behind both offline
 * entry points. One implementation on purpose: no lane re-decodes or
 * re-guards. The store's derived cache and jobs are emptied by the
 * successful `loadSource` — a new source never inherits the previous
 * source's results — and a REJECTED load keeps the previous source intact.
 */
async function decodeAndLoad(
  bytes: ArrayBuffer,
  name: string,
  sourceKind: SourceKind,
  decodeWav: DecodeWav,
  store: OfflineStore,
): Promise<LoadedSource> {
  let decoded: DecodedAudio;
  try {
    decoded = await decodeWav(bytes);
  } catch (error) {
    throw decodeFailedError(error);
  }

  const load = store
    .getState()
    .loadSource(monoDownmix(decoded), decoded.sampleRate, name, sourceKind);
  if (!load.ok) {
    throw new OfflineError({
      kind: "storeCode",
      code: load.code,
      messageKey: `input.error.${load.code}`,
    });
  }
  const settled = store.getState().original;
  if (settled === null) {
    // loadSource returned ok, so the source is set; this branch exists for
    // the null-narrowing only (same shape as the ingest lane).
    throw new OfflineError({
      kind: "storeCode",
      code: "invalidType",
      messageKey: "input.error.invalidType",
    });
  }
  return { ok: true, source: settled };
}

/**
 * Load one file through the offline decode lane (plan Task 2): read the
 * bytes → the shared decode seam → `loadSource(..., "offlineBrowser")`.
 * Resolves to the settled session source; REJECTS `OfflineError` on every
 * failure path (unreadable file, decode seam throw, store guard backstop).
 */
export async function loadOfflineFile(
  file: File,
  options: OfflineOptions = {},
): Promise<LoadedSource> {
  const { decodeWav = browserDecodeWav, store = useSessionStore } = options;
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch (error) {
    throw decodeFailedError(error);
  }
  return decodeAndLoad(bytes, file.name, "offlineBrowser", decodeWav, store);
}

/**
 * Bundled demo clips (D-016: self-generated, CC0-dedicated; byte-reproducible
 * by `tools/demo_clips/generate.py` — 48 kHz 16-bit mono, 5.0 s each).
 * Titles are i18n keys (`input.demo.<id>.title`); these fields stay
 * technical data (units in the names, AGENTS §10).
 */
export type DemoClip = {
  readonly id: "chirp" | "clicks" | "pinkNoise";
  readonly file: string;
  readonly seconds: number;
  readonly rateHz: number;
};

export const DEMO_CLIPS: readonly DemoClip[] = [
  { id: "chirp", file: "chirp-log-100to8000hz-5s.wav", seconds: 5, rateHz: 48_000 },
  { id: "clicks", file: "clicks-2hz-5s.wav", seconds: 5, rateHz: 48_000 },
  { id: "pinkNoise", file: "pink-noise-5s.wav", seconds: 5, rateHz: 48_000 },
];

/** URL the clip bytes load from (`public/` assets serve at the origin root). */
export function demoClipUrl(clip: DemoClip): string {
  return `/demo/${clip.file}`;
}

/** Fetch seam for the static clip bytes (tests inject a fake). */
export type DemoFetch = (url: string) => Promise<Response>;

const defaultDemoFetch: DemoFetch = (url) => fetch(url);

export type DemoOptions = OfflineOptions & {
  readonly fetch?: DemoFetch;
};

/**
 * Load one bundled demo clip (plan Task 2): fetch the static WAV from
 * `/demo/<file>.wav`, then the SAME decode → load tail as `loadOfflineFile`,
 * with `sourceKind: "demoClip"`. A failed fetch (throw or non-2xx) rejects
 * `demoUnavailable` — the static origin is not the API, so the
 * `backendOnline` flag stays untouched. An unknown clip id is an app bug
 * and fails loudly (TypeError), like the ingest lane's option validation.
 */
export async function loadDemoClip(
  clipId: string,
  options: DemoOptions = {},
): Promise<LoadedSource> {
  const {
    fetch: fetchFn = defaultDemoFetch,
    decodeWav = browserDecodeWav,
    store = useSessionStore,
  } = options;
  const clip = DEMO_CLIPS.find((candidate) => candidate.id === clipId);
  if (clip === undefined) {
    throw new TypeError(`loadDemoClip: unknown demo clip id ${JSON.stringify(clipId)}`);
  }
  let bytes: ArrayBuffer;
  try {
    const response = await fetchFn(demoClipUrl(clip));
    if (!response.ok) {
      throw new Error(`demo clip request answered ${String(response.status)}`);
    }
    bytes = await response.arrayBuffer();
  } catch (error) {
    throw demoUnavailableError(error);
  }
  return decodeAndLoad(bytes, clip.file, "demoClip", decodeWav, store);
}
