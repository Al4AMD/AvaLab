/**
 * Shared no-source empty state ("load audio" card, F01, Wave-2 Plan 02
 * Task 1): an invisible file input with an a11y-correct label (the keyboard
 * path — the input itself stays focusable) plus a dropzone on the card. The
 * session store and the ingest lane are wired through `useIngestFile`; view
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
 */
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { IngestError, ingestFile } from "./ingest";

/** Busy/error state of the card's loader (typed; no boolean soup). */
type IngestState = {
  readonly busy: boolean;
  readonly failure: IngestError | null;
};

/**
 * Small hook wiring `ingestFile` to the session store singleton: the lane
 * resolves after the store already holds the new source; failures keep the
 * previous source untouched and surface as the card's typed failure state.
 * Unexpected non-`IngestError` rejections are logged for developers and
 * surface as the lane kind (they must never vanish silently).
 */
function useIngestFile(): IngestState & { readonly loadFile: (file: File) => void } {
  const [state, setState] = useState<IngestState>({ busy: false, failure: null });

  function loadFile(file: File): void {
    if (state.busy) {
      return; // one upload at a time (the label is aria-disabled meanwhile)
    }
    setState({ busy: true, failure: null });
    void ingestFile(file).then(
      () => setState({ busy: false, failure: null }),
      (error: unknown) => {
        if (error instanceof IngestError) {
          setState({ busy: false, failure: error });
          return;
        }
        console.warn("avalab input: unexpected ingest failure", error);
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

  return { ...state, loadFile };
}

/** Visual classes of the file button — a <label> for the invisible input,
 * styled like the vendored Button (same base + disabled treatment). */
const FILE_BUTTON_CLASSES =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors " +
  "h-9 px-4 text-sm bg-accent text-bg hover:opacity-90 " +
  "focus-within:outline-none focus-within:ring-2 focus-within:ring-accent " +
  "aria-disabled:pointer-events-none aria-disabled:opacity-50";

function FailureReadout({ failure }: { failure: IngestError }) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="input.upload.error"
      role="alert"
      className="flex flex-col gap-1 rounded-md border border-surface bg-surface/50 p-3 text-start"
    >
      <p className="text-sm">
        {t(failure.messageKey, failure.code === undefined ? undefined : { code: failure.code })}
      </p>
      {failure.kind === "backendUnavailable" && (
        <p className="text-xs text-muted">{t("input.error.backendUnavailableHint")}</p>
      )}
    </div>
  );
}

/**
 * The "no source yet" block. Drag-and-drop is the pointer enhancement; the
 * file input behind the label is the keyboard-operable alternative (it is
 * visually hidden, not unfocusable, and shows the focus ring on its label
 * via focus-within).
 */
export function UploadEmptyState() {
  const { t } = useTranslation();
  const { busy, failure, loadFile } = useIngestFile();
  const [dragging, setDragging] = useState(false);
  const inputId = useId();

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only dropzone; keyboard path is the file input
    <div
      data-testid="input.upload.dropzone"
      onDragOver={(event) => {
        event.preventDefault(); // allow the drop; the browser must not navigate
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
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
      {failure !== null && <FailureReadout failure={failure} />}
    </div>
  );
}
