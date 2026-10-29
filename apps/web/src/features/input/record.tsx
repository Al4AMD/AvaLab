/**
 * Microphone recording affordance (F01, Wave-2 Plan 02 Task 3) — the third
 * entry point of the shared no-source empty state, below the demo cards.
 *
 * The browser recorder life cycle lives entirely in `lib/media.ts`'s typed
 * state machine (every boundary injectable; node tests drive it without a
 * mic). This view only: subscribes via `useSyncExternalStore`, renders the
 * phase-translated controls, and, on a COMPLETED take, hands the recorded
 * file to Task 1's ingest lane with `sourceKind: "recording"` — there is no
 * second loader and no second upload implementation (plan Task 3).
 *
 * Honest degradation (plan Review Focus 4): a browser without mediaDevices
 * shows the absent-devices hint with an `aria-disabled` (non-focusable,
 * non-clickable) button; a permission denial lands in the machine's
 * `requestingDenied` state and surfaces translated; NO recording failure
 * writes the backendOnline flags (the recorder is lane-agnostic — the
 * ingest lane's own evidence flips are the only flag writers, Task 1).
 *
 * The elapsed readout is an `aria-live="polite"` integer counter; per
 * AGENTS §6 the seconds figure is a plain digit string that reads the same
 * in RTL and LTR (both locales consume one `{seconds}` slot).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/button";
import type { Recorder, RecorderState } from "../../lib/media";
import {
  createRecorder,
  hasMediaDevices,
  MAX_RECORDING_SECONDS,
  recordingFileName,
} from "../../lib/media";
import { LaneFailureReadout } from "./failureReadout";
import { IngestError, ingestFile } from "./ingest";

/**
 * One recording/upload at a time across the WHOLE empty state is the
 * component's rule (the machine itself re-arms for the next take): a take
 * in flight shows stop/cancel and holds the other affordances still.
 */
function useRecorder(onCompleted: (state: Extract<RecorderState, { phase: "done" }>) => void): {
  readonly recorder: Recorder | null;
  readonly state: RecorderState;
} {
  const [recorder, setRecorder] = useState<Recorder | null>(null);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  useEffect(() => {
    const machine = createRecorder({
      onComplete: (completion) => {
        onCompletedRef.current({ phase: "done", outcome: completion });
      },
    });
    setRecorder(machine);
    return () => {
      machine.dispose();
    };
  }, []);

  const state = useSyncExternalStore(
    (notify) => recorder?.subscribe(notify) ?? (() => {}),
    () => recorder?.getState() ?? ({ phase: "idle" } as RecorderState),
    // Server snapshot = the same live selector (the SSR unit renders have no
    // hydration; routes.test.tsx renderToStaticMarkup must not warn).
    () => recorder?.getState() ?? ({ phase: "idle" } as RecorderState),
  );
  return { recorder, state };
}

/** Recording segment of the empty state: the machine phases → copy. */
export function RecordSection(): React.ReactElement {
  const { t } = useTranslation();
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadFailure, setUploadFailure] = useState<IngestError | null>(null);

  function sendToIngest(recordedState: Extract<RecorderState, { phase: "done" }>): void {
    const { outcome } = recordedState;
    // The cap take is NOT uploaded (the backend would reject it with
    // duration_too_long; plan Task 3: honest UX first) — the machine's
    // `done(capReached)` state renders the translated message instead and
    // the user simply records again.
    if (outcome.kind !== "completed") {
      return;
    }
    setUploadBusy(true);
    setUploadFailure(null);
    const mime = outcome.blob.type;
    const file = new File([outcome.blob], recordingFileName(mime), { type: mime });
    void ingestFile(file, { sourceKind: "recording" }).then(
      () => {
        setUploadBusy(false);
        setUploadFailure(null);
      },
      (error: unknown) => {
        setUploadBusy(false);
        if (error instanceof IngestError) {
          setUploadFailure(error);
          return;
        }
        console.warn("avalab input: unexpected recording upload failure", error);
        setUploadFailure(
          new IngestError({
            kind: "backendUnavailable",
            code: undefined,
            messageKey: "input.error.backendUnavailable",
          }),
        );
      },
    );
  }

  const { recorder, state } = useRecorder(sendToIngest);

  // No media API at all: the honest hint, no focusable no-op button.
  if (!hasMediaDevices()) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">{t("input.record.title")}</p>
        <p data-testid="input.record.absent" className="text-xs text-muted">
          {t("input.record.absentHint")}
        </p>
      </div>
    );
  }

  if (state.phase === "recording") {
    return <RecordingControls recorder={recorder} />;
  }

  const busy = state.phase === "requesting" || state.phase === "processing" || uploadBusy;
  const denied = state.phase === "requestingDenied";
  const mediaError = state.phase === "error" ? state.mediaError : null;
  const capReached = state.phase === "done" && state.outcome.kind === "capReached";

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">{t("input.record.title")}</p>
      {!busy && (
        <Button
          variant="outline"
          size="sm"
          data-testid="input.record.start"
          className="self-center"
          onClick={() => {
            setUploadFailure(null);
            void recorder?.start();
          }}
        >
          {t("input.record.start")}
        </Button>
      )}
      {busy && <p className="text-center text-sm">{t("input.record.busy")}</p>}
      {denied && (
        <p data-testid="input.record.denied" role="alert" className="text-sm">
          {t("input.record.deniedHint")}
        </p>
      )}
      {mediaError !== null && (
        <p data-testid="input.record.error" role="alert" className="text-sm">
          {t("input.record.mediaError", { error: mediaError })}
        </p>
      )}
      {capReached && (
        <p data-testid="input.record.capReached" role="alert" className="text-sm">
          {t("input.record.capReached")}
        </p>
      )}
      {uploadFailure !== null && (
        <LaneFailureReadout failure={uploadFailure} testId="input.record.error" />
      )}
    </div>
  );
}

/** The live-recording controls: stop, cancel, and the aria-live counter.
 * The elapsed timer is a 1 s interval owned ONLY by this snippet's life. */
function RecordingControls({
  recorder,
}: {
  readonly recorder: Recorder | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    const tick = setInterval(() => {
      setElapsedSeconds((value) => value + 1);
    }, 1_000);
    return () => {
      clearInterval(tick);
    };
  }, []);
  // The display never exceeds the app-wide cap (one constant, pinned equal
  // to the store's MAX_DURATION_SECONDS by the media unit test).
  const shown = Math.min(elapsedSeconds, MAX_RECORDING_SECONDS);
  return (
    <div className="flex flex-col gap-2">
      <p data-testid="input.record.elapsed" aria-live="polite" className="text-center text-sm">
        {t("input.record.elapsed", { seconds: shown })}
      </p>
      <div className="flex justify-center gap-2">
        <Button
          size="sm"
          data-testid="input.record.stop"
          onClick={() => {
            recorder?.stop();
          }}
        >
          {t("input.record.stop")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="input.record.cancel"
          onClick={() => {
            recorder?.cancel();
          }}
        >
          {t("input.record.cancel")}
        </Button>
      </div>
    </div>
  );
}
