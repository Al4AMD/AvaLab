/**
 * The dock player (F02, Wave-2 Plan 02 Task 4) — fills Plan 01's docked
 * player placeholder on every tool page via the app layout.
 *
 * View rules:
 * - Thin painter over `usePlayer` + the store: no DSP, no AudioContext, no
 *   worker calls here.
 * - The time readout throttles the playhead pub-sub at ONE update per
 *   displayed second (`mm:ss` precision) — canvases (Plan 03) subscribe to
 *   `appPlayhead` themselves; the player NEVER re-renders canvases and
 *   never runs a second rAF loop (the publish loop belongs to usePlayer).
 * - Disabled when no source is loaded; the no-source hint is honest
 *   visible text, buttons disabled not hidden. The selection
 *   readout is store-bound read-only text; the loop toggle is a reserved
 *   stub, disabled until Wave 3's derived sources exist.
 * - i18n: every user-visible string through `player.*`; the readouts are
 *   technical `mm:ss` figures in Latin digits inside `dir="ltr"` spans
 *   (AGENTS §6: time flows left→right in both languages); logical spacing
 *   utilities only, so the row mirrors under RTL.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/button";
import { useSessionStore } from "../../session/store";
import { appPlayhead, type PlayheadListener } from "./playhead";
import { type PlayerApi, usePlayer } from "./usePlayer";

/** Keyboard seek steps (AGENTS §10: units in the name, no magic numbers). */
const SEEK_STEP_SECONDS = 5;
const SEEK_JUMP_SECONDS = 10;

/** Locale-neutral `mm:ss` from a sample index at the source's rate. Latin
 * digits for technical readouts (AGENTS §6); truncated (floor) seconds. */
function formatMmss(sample: number, sampleRateHz: number): string {
  const seconds = Math.max(0, Math.trunc(sample / sampleRateHz));
  const minutes = Math.trunc(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The displayed head sample: the throttled playhead subscription while
 * playing, the transport's pinned position otherwise (pause/end/empty).
 * Throttle = re-render the dock (small tree) at most once per second.
 */
function useDisplayedSample(player: PlayerApi): number {
  const playing = player.state.phase === "playing";
  const [displaySample, setDisplaySample] = useState<number | null>(null);

  useEffect(() => {
    if (!playing || player.machine === null) {
      return;
    }
    setDisplaySample(null); // a fresh run starts at the fresh head
    const listener: PlayheadListener = (sample) => {
      setDisplaySample((previous) => {
        const previousSecond = Math.trunc((previous ?? sample) / player.sampleRateHz);
        const nextSecond = Math.trunc(sample / player.sampleRateHz);
        return previous !== null && previousSecond === nextSecond ? previous : sample;
      });
    };
    return appPlayhead.subscribe(listener);
  }, [playing, player.machine, player.sampleRateHz]);

  if (playing) {
    return displaySample ?? 0;
  }
  return player.state.phase === "empty" ? 0 : player.state.positionSample;
}

/** The docked player panel — the layout renders exactly one, per page. */
export function PlayerDock(): React.ReactElement {
  const { t } = useTranslation();
  const player = usePlayer();
  const selection = useSessionStore((state) => state.selection);
  const original = useSessionStore((state) => state.original);
  const displayedSample = useDisplayedSample(player);

  // A source is present only when the transport actually holds samples
  // (a zero-length source plays nothing — the hint stays honest).
  const hasSource = player.lengthSamples > 0 && player.sampleRateHz > 0;
  const playing = player.state.phase === "playing";
  const current = formatMmss(displayedSample, player.sampleRateHz);
  const total = formatMmss(player.lengthSamples, player.sampleRateHz);

  return (
    <section
      data-testid="player.dock"
      aria-label={t("player.title")}
      className="flex min-h-16 flex-wrap items-center gap-2 border-t border-surface px-6 py-2"
    >
      <Button
        size="sm"
        variant="outline"
        data-testid="player.back10"
        disabled={!hasSource}
        onClick={() => {
          player.seekBySeconds(-SEEK_JUMP_SECONDS);
        }}
      >
        {t("player.seek.back", { seconds: SEEK_JUMP_SECONDS })}
      </Button>
      <Button
        size="sm"
        variant="outline"
        data-testid="player.back5"
        disabled={!hasSource}
        onClick={() => {
          player.seekBySeconds(-SEEK_STEP_SECONDS);
        }}
      >
        {t("player.seek.back", { seconds: SEEK_STEP_SECONDS })}
      </Button>
      <Button
        size="sm"
        data-testid="player.playToggle"
        aria-pressed={playing}
        disabled={!hasSource}
        onClick={() => {
          player.togglePlay();
        }}
      >
        {playing ? t("player.pause") : t("player.play")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        data-testid="player.forward5"
        disabled={!hasSource}
        onClick={() => {
          player.seekBySeconds(SEEK_STEP_SECONDS);
        }}
      >
        {t("player.seek.forward", { seconds: SEEK_STEP_SECONDS })}
      </Button>
      <Button
        size="sm"
        variant="outline"
        data-testid="player.forward10"
        disabled={!hasSource}
        onClick={() => {
          player.seekBySeconds(SEEK_JUMP_SECONDS);
        }}
      >
        {t("player.seek.forward", { seconds: SEEK_JUMP_SECONDS })}
      </Button>
      <Button
        size="sm"
        variant="outline"
        data-testid="player.loop"
        disabled
        title={t("player.loop.unavailable")}
        aria-label={t("player.loop.unavailable")}
      >
        {t("player.loop.label")}
      </Button>
      {hasSource ? (
        <span
          dir="ltr"
          role="timer"
          data-testid="player.time"
          aria-label={t("player.time.aria", { current, total })}
          className="text-sm tabular-nums text-muted"
        >
          {t("player.time.pattern", { current, total })}
        </span>
      ) : (
        <p data-testid="player.empty" className="text-sm text-muted">
          {t("player.empty.hint")}
        </p>
      )}
      {hasSource && (
        <span dir="ltr" data-testid="player.selection" className="text-xs text-muted">
          {t("player.selection.pattern", {
            start: formatMmss(selection.startSample, player.sampleRateHz),
            end: formatMmss(selection.endSample, player.sampleRateHz),
          })}
        </span>
      )}
      {hasSource && original && (
        <span
          data-testid="player.lane"
          className="ms-auto border border-line px-2 py-0.5 text-xs text-muted"
        >
          {t(`player.lane.${original.sourceKind}`)}
        </span>
      )}
    </section>
  );
}
