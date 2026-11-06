import { useCallback, useEffect, useRef, useState } from "react";

import { useSessionStore } from "../../session/store";
import { matchGainDb } from "./loudnessMath";
import type { PlayerApi } from "./usePlayer";

export const LOUDNESS_MATCH_STORAGE_KEY = "avalab.loudnessMatch";

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

export type LoudnessMatchStatus = "off" | "measuring" | "ready" | "error";
export type LoudnessMatchSnapshot = {
  readonly gainDb: number;
  readonly originalLufs: number | null;
  readonly processedLufs: number | null;
  readonly status: LoudnessMatchStatus;
};

export type LoudnessLane = {
  readonly samples: Float32Array;
  readonly sampleRateHz: number;
};

export type LoudnessMatchInput = {
  readonly enabled: boolean;
  readonly activeKind: "original" | "processed";
  readonly original: LoudnessLane | null;
  readonly processed: LoudnessLane | null;
};

export type LoudnessMatcher = {
  run(input: LoudnessMatchInput): void;
  cancel(): void;
};

export type LoudnessMatcherDeps = {
  readonly measureLane: (samples: Float32Array, sampleRateHz: number) => Promise<number>;
  readonly setGainDb: (gainDb: number) => void;
  readonly onChange: (snapshot: LoudnessMatchSnapshot) => void;
};

const OFF_SNAPSHOT: LoudnessMatchSnapshot = {
  gainDb: 0,
  originalLufs: null,
  processedLufs: null,
  status: "off",
};

function browserStorage(): (StorageReader & StorageWriter) | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readLoudnessMatchEnabled(
  storage: StorageReader | null = browserStorage(),
): boolean {
  try {
    return storage?.getItem(LOUDNESS_MATCH_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeLoudnessMatchEnabled(
  enabled: boolean,
  storage: StorageWriter | null = browserStorage(),
): void {
  try {
    storage?.setItem(LOUDNESS_MATCH_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Private mode/storage failure: the in-memory toggle still works.
  }
}

/**
 * Measurement coordinator separated from React so stale-result and gain
 * rules are unit-testable without a DOM. Each `run` invalidates the previous
 * generation before starting; a late promise can never apply a gain.
 */
export function createLoudnessMatcher(deps: LoudnessMatcherDeps): LoudnessMatcher {
  let generation = 0;

  function reset(): void {
    deps.setGainDb(0);
    deps.onChange(OFF_SNAPSHOT);
  }

  function fail(token: number): void {
    if (token !== generation) {
      return;
    }
    deps.setGainDb(0);
    deps.onChange({ gainDb: 0, originalLufs: null, processedLufs: null, status: "error" });
  }

  return {
    run(input) {
      const token = ++generation;
      if (
        !input.enabled ||
        input.activeKind !== "processed" ||
        input.original === null ||
        input.processed === null
      ) {
        reset();
        return;
      }

      // While a new measurement is in flight the old gain would be a lie
      // about this lane: start at unity and publish the result when ready.
      deps.setGainDb(0);
      deps.onChange({
        gainDb: 0,
        originalLufs: null,
        processedLufs: null,
        status: "measuring",
      });

      let measurement: Promise<readonly [number, number]>;
      try {
        measurement = Promise.all([
          deps.measureLane(input.original.samples, input.original.sampleRateHz),
          deps.measureLane(input.processed.samples, input.processed.sampleRateHz),
        ]);
      } catch {
        fail(token);
        return;
      }

      void measurement.then(
        ([originalLufs, processedLufs]) => {
          if (token !== generation) {
            return;
          }
          const gainDb = matchGainDb(originalLufs, processedLufs);
          deps.setGainDb(gainDb);
          deps.onChange({
            gainDb,
            originalLufs,
            processedLufs,
            status: "ready",
          });
        },
        () => {
          fail(token);
        },
      );
    },

    cancel() {
      generation += 1;
    },
  };
}

function measureLaneInWorker(samples: Float32Array, sampleRateHz: number): Promise<number> {
  const copy = new Float32Array(samples);
  const ticket = useSessionStore
    .getState()
    .deriveStandalone(
      "loudnessMeasure",
      { sampleRateHz },
      { buffer: copy.buffer, byteOffset: 0, byteLength: copy.byteLength },
    );
  return ticket.outcome.then((outcome) => {
    if ("cancelled" in outcome) {
      throw new Error("loudness measurement cancelled");
    }
    return outcome.integratedLufs;
  });
}

export type LoudnessMatchApi = LoudnessMatchSnapshot & {
  readonly enabled: boolean;
  readonly toggle: () => void;
};

export function useLoudnessMatch(player: PlayerApi): LoudnessMatchApi {
  const [enabled, setEnabled] = useState(readLoudnessMatchEnabled);
  const [snapshot, setSnapshot] = useState<LoudnessMatchSnapshot>(OFF_SNAPSHOT);
  const playerRef = useRef(player);
  playerRef.current = player;

  const original = useSessionStore((state) => state.original);
  const processed = useSessionStore((state) => state.processed);
  const activeKind = player.activeKind;

  useEffect(() => {
    const matcher = createLoudnessMatcher({
      measureLane: measureLaneInWorker,
      setGainDb: (gainDb) => {
        playerRef.current.setGainDb(gainDb);
      },
      onChange: setSnapshot,
    });
    matcher.run({ enabled, activeKind, original, processed });
    return () => {
      matcher.cancel();
    };
  }, [enabled, activeKind, original, processed]);

  const toggle = useCallback(() => {
    setEnabled((previous) => {
      const next = !previous;
      writeLoudnessMatchEnabled(next);
      return next;
    });
  }, []);

  return {
    enabled,
    toggle,
    ...snapshot,
  };
}
