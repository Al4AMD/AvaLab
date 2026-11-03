/**
 * Demo clip cards (F01, Wave-2 Plan 02 Task 2) — the bundled CC0 clips
 * (D-016) loaded through the offline decode lane (spec §2.4). Rendered by
 * the shared no-source empty state, so every surface that shows that state
 * offers the clips. A11y: the card itself is never interactive — each card
 * carries real buttons labelled with its clip's title (plan Review Focus 5).
 * Card titles are i18n keys; the technical meta line is a locale-neutral
 * numeric+unit string wrapped in `dir="ltr"` (AGENTS §6).
 *
 * Share (F16): every card can copy a link for the CURRENT tool path/params
 * plus `?demo=<id>`; the deep link loads the clip once per navigation without
 * touching the URL, and only when no source is loaded. Uploads never appear
 * in share links — the helper accepts tool params and bundled demo ids only.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";

import { Button } from "../../components/ui/button";
import { buildShareUrl } from "../../lib/share";
import { decodeParams } from "../../lib/url-state";
import { useSessionStore } from "../../session/store";
import { createDemoDeepLinkTracker } from "./demoDeepLink";
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

type CopyStatus = { readonly kind: "copied" | "failed"; readonly clipId: string };

/**
 * The demo row of the no-source empty state: one card per bundled clip,
 * each with its title, a technical meta line (format · duration · rate,
 * LTR), the load button, and a copy-share-link button.
 */
export function DemoClipsRow() {
  const { t } = useTranslation();
  const location = useLocation();
  const hasSource = useSessionStore((state) => state.original !== null);
  const { busyId, failure, load } = useDemoClipLoader();
  const deepLinkTracker = useRef(createDemoDeepLinkTracker());
  const [copyStatus, setCopyStatus] = useState<CopyStatus | null>(null);

  useEffect(() => {
    const demoId = deepLinkTracker.current.take({
      search: location.search,
      navigationKey: location.key,
      hasSource,
    });
    if (demoId === null) {
      return;
    }
    const clip = DEMO_CLIPS.find((candidate) => candidate.id === demoId);
    if (clip !== undefined) {
      load(clip);
    }
  }, [hasSource, load, location.key, location.search]);

  function copyShareLink(clip: DemoClip): void {
    setCopyStatus(null);
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) {
      setCopyStatus({ kind: "failed", clipId: clip.id });
      return;
    }
    const relative = buildShareUrl({
      path: location.pathname,
      params: decodeParams(location.search),
      demoId: clip.id,
    });
    const absolute = new URL(relative, window.location.href).href;
    void clipboard.writeText(absolute).then(
      () => {
        setCopyStatus({ kind: "copied", clipId: clip.id });
      },
      () => {
        setCopyStatus({ kind: "failed", clipId: clip.id });
      },
    );
  }

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
            <div className="flex items-center gap-1">
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
              <Button
                variant="outline"
                size="sm"
                data-testid={`input.demo.share.${clip.id}`}
                aria-label={t("input.demo.shareAria", {
                  title: t(`input.demo.${clip.id}.title`),
                })}
                onClick={() => {
                  copyShareLink(clip);
                }}
              >
                {t("input.demo.shareButton")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {copyStatus !== null && (
        <p role="status" className="text-xs text-muted">
          {copyStatus.kind === "copied" ? t("input.demo.shareCopied") : t("input.demo.shareFailed")}
        </p>
      )}
      {failure !== null && <LaneFailureReadout failure={failure} testId="input.demo.error" />}
    </div>
  );
}
