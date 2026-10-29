/**
 * Demo clip cards (F01, Wave-2 Plan 02 Task 2) — the bundled CC0 clips
 * (D-016) loaded through the offline decode lane (spec §2.4). Rendered by
 * the shared no-source empty state, so every surface that shows that state
 * offers the clips. A11y: the card itself is never interactive — each card
 * carries exactly ONE real button, labelled with its clip's title
 * (plan Review Focus 5). Card titles are i18n keys; the technical meta line
 * is a locale-neutral numeric+unit string wrapped in `dir="ltr"` (AGENTS §6).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/button";
import { LaneFailureReadout } from "./failureReadout";
import { DEMO_CLIPS, type DemoClip, loadDemoClip, OfflineError } from "./offline";

/**
 * One demo load at a time; failures surface as the row's typed readout
 * (translated at render time, like the upload card's). Unexpected
 * non-`OfflineError` rejections are logged for developers and surface as
 * the typed lane failure — never silent.
 */
function useDemoClipLoader(): {
  readonly busyId: string | null;
  readonly failure: OfflineError | null;
  readonly load: (clip: DemoClip) => void;
} {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failure, setFailure] = useState<OfflineError | null>(null);

  function load(clip: DemoClip): void {
    if (busyId !== null) {
      return; // one clip at a time (the buttons are aria-disabled meanwhile)
    }
    setBusyId(clip.id);
    setFailure(null);
    void loadDemoClip(clip.id).then(
      () => {
        setBusyId(null);
        setFailure(null);
      },
      (error: unknown) => {
        if (error instanceof OfflineError) {
          setBusyId(null);
          setFailure(error);
          return;
        }
        console.warn("avalab input: unexpected demo load failure", error);
        setBusyId(null);
        setFailure(
          new OfflineError(
            { kind: "demoUnavailable", code: undefined, messageKey: "input.error.demoUnavailable" },
            { cause: error },
          ),
        );
      },
    );
  }

  return { busyId, failure, load };
}

/**
 * The demo row of the no-source empty state: one card per bundled clip,
 * each with its title, a technical meta line (format · duration · rate,
 * LTR) and the load button.
 */
export function DemoClipsRow() {
  const { t } = useTranslation();
  const { busyId, failure, load } = useDemoClipLoader();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">{t("input.demo.title")}</p>
      <ul className="flex flex-wrap justify-center gap-2">
        {DEMO_CLIPS.map((clip) => (
          <li
            key={clip.id}
            data-testid={`input.demo.card.${clip.id}`}
            className="flex flex-col items-center gap-2 rounded-md border border-surface px-3 py-2"
          >
            <span className="text-sm">{t(`input.demo.${clip.id}.title`)}</span>
            <span dir="ltr" className="text-xs text-muted">
              {t("input.demo.meta", { seconds: clip.seconds, rateHz: clip.rateHz })}
            </span>
            <Button
              variant="outline"
              size="sm"
              data-testid={`input.demo.load.${clip.id}`}
              aria-label={t("input.demo.loadAria", { title: t(`input.demo.${clip.id}.title`) })}
              aria-disabled={busyId !== null || undefined}
              className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
              onClick={() => {
                load(clip);
              }}
            >
              {busyId === clip.id ? t("input.demo.loading") : t("input.demo.loadButton")}
            </Button>
          </li>
        ))}
      </ul>
      {failure !== null && <LaneFailureReadout failure={failure} testId="input.demo.error" />}
    </div>
  );
}
