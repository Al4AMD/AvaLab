import { useEffect, useRef } from "react";

import type { PlayerApi } from "../features/player/usePlayer";

/** The editable surfaces where typing must win over global shortcuts. */
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"], [role="dialog"]';

export type ShortcutAction =
  | { readonly kind: "togglePlay" }
  | { readonly kind: "seek"; readonly deltaSeconds: number }
  | { readonly kind: "showHelp" };

export type ShortcutEvent = {
  readonly key: string;
  readonly target: EventTarget | null;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly repeat?: boolean;
};

/**
 * True for form/text surfaces and anything inside an open dialog. The check
 * is structural (`closest`) so it is testable without a DOM and works for
 * the event target itself as well as its ancestors.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== "object") {
    return false;
  }
  const element = target as { closest?: unknown };
  if (typeof element.closest !== "function") {
    return false;
  }
  try {
    return (element.closest as (selector: string) => unknown)(EDITABLE_SELECTOR) !== null;
  } catch {
    return false;
  }
}

/**
 * Map one key event to a global player action. Returns null for repeats,
 * editable targets, modifier chords, and play/seek keys without a source.
 * `?` stays available without a source so the help panel is always reachable.
 */
export function resolveShortcut(event: ShortcutEvent, hasSource: boolean): ShortcutAction | null {
  if (event.repeat === true || isEditableTarget(event.target)) {
    return null;
  }
  if (event.ctrlKey === true || event.metaKey === true || event.altKey === true) {
    return null;
  }
  if (event.key === "?") {
    return { kind: "showHelp" };
  }
  if (!hasSource) {
    return null;
  }
  if (event.key === " " || event.key === "Spacebar") {
    return { kind: "togglePlay" };
  }
  if (event.key === "ArrowLeft") {
    return { kind: "seek", deltaSeconds: event.shiftKey === true ? -10 : -5 };
  }
  if (event.key === "ArrowRight") {
    return { kind: "seek", deltaSeconds: event.shiftKey === true ? 10 : 5 };
  }
  return null;
}

type ShortcutPlayer = Pick<PlayerApi, "lengthSamples" | "togglePlay" | "seekBySeconds">;

/** Install the global listener; refs keep one listener for the app lifetime. */
export function useGlobalShortcuts({
  player,
  onShowHelp,
}: {
  readonly player: ShortcutPlayer;
  readonly onShowHelp: () => void;
}): void {
  const playerRef = useRef(player);
  const showHelpRef = useRef(onShowHelp);
  playerRef.current = player;
  showHelpRef.current = onShowHelp;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = resolveShortcut(
        {
          key: event.key,
          target: event.target,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          repeat: event.repeat,
        },
        playerRef.current.lengthSamples > 0,
      );
      if (action === null) {
        return;
      }
      event.preventDefault();
      if (action.kind === "togglePlay") {
        playerRef.current.togglePlay();
      } else if (action.kind === "seek") {
        playerRef.current.seekBySeconds(action.deltaSeconds);
      } else {
        showHelpRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
