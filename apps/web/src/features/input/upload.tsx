/**
 * Shared no-source empty state ("load audio" card, F01, Wave-2 Plan 02
 * Task 1): an invisible file input with an a11y-correct label (the keyboard
 * path — the input itself stays focusable) plus a dropzone on the card. The
 * session store and the file lanes are wired through `useFileLoader`; view
 * code performs no fetch and no AudioContext work (plan architecture).
 *
 * Rejections are structured (`IngestError`): the component translates the
 * failure's `messageKey` at render time so a locale switch re-renders
 * correctly, pairs `kind: "backendUnavailable"` with an actionable recovery
 * hint, and never swallows unknown backend codes (the code surfaces
 * verbatim through `input.error.unknown`).
 *
 * Nothing here truncates: the session store's guards (≤ 96 kHz, ≤ 300 s)
 * REJECT out-of-cap samples — this card surfaces that typed rejection.
 *
 * Wave-2 Plan 02 Task 2 (review findings 1+2): the block also carries the
 * bundled demo clips. The "offline lane only" hint and the file lane are
 * EVIDENCE-gated, never keyed on the raw `backendOnline` flag (it starts
 * false as "not yet proven"): the hint renders only when an ingest attempt
 * failed on this mount (the lane readout state) or the boot /health probe
 * has SETTLED (`backendProbeSettled` via HealthStatus's mark). Under the
 * same evidence the file input/drop routes the OFFLINE lane
 * (`loadOfflineFile`, sourceKind "offlineBrowser") instead of the ingest
 * lane; the Task-1 flow is unchanged otherwise — a failed upload still
 * surfaces the same typed error (plan Review Focus 3).
 */
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSessionStore } from "../../session/store";
import { DemoClipsRow } from "./demo";
import { LaneFailureReadout } from "./failureReadout";
import { IngestError, ingestFile, type LoadedSource } from "./ingest";
import { loadOfflineFile, OfflineError } from "./offline";
import { RecordSection } from "./record";

/** Busy/error state of the card's loader (typed; no boolean soup). The
 * failure carries EITHER lane's readout view (both satisfy
 * `LaneFailureView`). */
type FileLoadState = {
  readonly busy: boolean;
  readonly failure: IngestError | OfflineError | null;
};

/**
 * The offline-lane evidence gate (review findings 1+2): true only when (a)
 * an ingest attempt failed on this mount (the lane readout state), or (b)
 * the boot probe settled AND proved the backend offline (`backendOnline ===
 * false AND backendProbeSettled`). During the boot window with no failure
 * the gate is FALSE — `backendOnline` still means "not yet proven", so the
 * hint must not make its claim yet and the file input must keep the ingest
 * lane.
 */
export type OfflineLaneEvidence = {
  readonly backendOnline: boolean;
  readonly backendProbeSettled: boolean;
  readonly laneFailure: IngestError | OfflineError | null;
};

export function offlineLaneEvidence(evidence: OfflineLaneEvidence): boolean {
  return evidence.laneFailure !== null || (!evidence.backendOnline && evidence.backendProbeSettled);
}

/**
 * Hook wiring the file lane to the session store singleton: the lane is
 * picked per call from the evidence gate (ingest lane routes ONLINE, the
 * offline lane only under real evidence); the store resolves after it
 * already holds the new source; failures keep the previous source untouched
 * and surface as the card's typed failure state (either lane's error class
 * satisfies the readout). Unexpected non-typed rejections are logged for
 * developers and surface as the lane kind (they must never vanish silently).
 */
function useFileLoader(): FileLoadState & {
  readonly offlineLane: boolean;
  readonly loadFile: (file: File) => void;
} {
  const [state, setState] = useState<FileLoadState>({ busy: false, failure: null });
  const backendOnline = useSessionStore((s) => s.backendOnline);
  const backendProbeSettled = useSessionStore((s) => s.backendProbeSettled);
  const offlineLane = offlineLaneEvidence({
    backendOnline,
    backendProbeSettled,
    laneFailure: state.failure,
  });

  function loadFile(file: File): void {
    if (state.busy) {
      return; // one upload at a time (the label is aria-disabled meanwhile)
    }
    setState({ busy: true, failure: null });
    const run: Promise<LoadedSource> = offlineLane ? loadOfflineFile(file) : ingestFile(file);
    void run.then(
      () => setState({ busy: false, failure: null }),
      (error: unknown) => {
        if (error instanceof IngestError || error instanceof OfflineError) {
          setState({ busy: false, failure: error });
          return;
        }
        console.warn("avalab input: unexpected load failure", error);
        setState({
          busy: false,
          failure: new IngestError(
            {
              kind: "backendUnavailable",
              code: undefined,
              messageKey: "input.error.backendUnavailable",
            },
            { cause: error },
          ),
        });
      },
    );
  }

  return { ...state, offlineLane, loadFile };
}

/**
 * The "offline lane only" hint: the hint's exact copy is store-contract free
 * (only the key is rendered here); `show` comes from `offlineLaneEvidence`
 * at the card level, store reads included.
 */
function OfflineLaneHint({ show }: { readonly show: boolean }) {
  const { t } = useTranslation();
  return show ? (
    <p data-testid="input.offlineLaneOnly" className="text-xs text-muted">
      {t("input.offlineLaneOnly")}
    </p>
  ) : null;
}

/** Visual classes of the file button — a <label> for the invisible input,
 * styled like the vendored Button (same base + disabled treatment). */
const FILE_BUTTON_CLASSES =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors " +
  "h-9 px-4 text-sm bg-accent text-bg hover:opacity-90 " +
  "focus-within:outline-none focus-within:ring-2 focus-within:ring-accent " +
  "aria-disabled:pointer-events-none aria-disabled:opacity-50";

/**
 * The "no source yet" block. Drag-and-drop is the pointer enhancement; the
 * file input behind the label is the keyboard-operable alternative (it is
 * visually hidden, not unfocusable, and shows the focus ring on its label
 * via focus-within).
 */
export function UploadEmptyState() {
  const { t } = useTranslation();
  const { busy, failure, offlineLane, loadFile } = useFileLoader();
  const [dragging, setDragging] = useState(false);
  // Standard dragenter/dragleave counter: child elements fire their own
  // leave events, which would flicker the ring without a depth count.
  const dragDepth = useRef(0);
  const inputId = useId();

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only dropzone; keyboard path is the file input
    <div
      data-testid="input.upload.dropzone"
      onDragEnter={() => {
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault(); // allow the drop; the browser must not navigate
      }}
      onDragLeave={() => {
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const dropped = event.dataTransfer.files[0];
        if (dropped !== undefined) {
          loadFile(dropped);
        }
      }}
      className={
        "flex flex-col items-center gap-3 rounded-lg border border-dashed border-surface p-8 text-center " +
        (dragging ? "ring-2 ring-accent" : "")
      }
    >
      <p className="text-sm text-muted">{t("input.empty.hint")}</p>
      <OfflineLaneHint show={offlineLane} />
      <input
        data-testid="input.upload.input"
        id={inputId}
        type="file"
        accept="audio/*"
        disabled={busy}
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          if (chosen !== undefined) {
            loadFile(chosen);
          }
          event.target.value = ""; // allow re-selecting the same file
        }}
        className="sr-only"
      />
      <label
        data-testid="input.upload.button"
        htmlFor={inputId}
        aria-disabled={busy || undefined}
        className={FILE_BUTTON_CLASSES}
      >
        {busy ? t("input.busy") : t("input.fileButton")}
      </label>
      {failure !== null && <LaneFailureReadout failure={failure} testId="input.upload.error" />}
      <DemoClipsRow />
      <RecordSection />
    </div>
  );
}
