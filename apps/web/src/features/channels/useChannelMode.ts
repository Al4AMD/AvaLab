import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

import {
  availableChannelModes,
  CHANNEL_QUERY_KEY,
  type ChannelMode,
  type ChannelSource,
  type ChannelToolSupport,
  channelModeFromSearch,
  channelModeToSearch,
} from "../../lib/channel";

export type ChannelModeState = {
  readonly mode: ChannelMode;
  readonly modes: readonly ChannelMode[];
  readonly setMode: (mode: ChannelMode) => void;
};

export function useChannelMode(
  source: ChannelSource | null,
  support: ChannelToolSupport,
): ChannelModeState {
  const [searchParams, setSearchParams] = useSearchParams();
  const modes = useMemo(() => availableChannelModes(source, support), [source, support]);
  const requested = channelModeFromSearch(searchParams);
  const mode = modes.includes(requested) ? requested : "mono";

  const setMode = useCallback(
    (next: ChannelMode) => {
      if (!modes.includes(next)) {
        return;
      }
      const params = new URLSearchParams(searchParams);
      const encoded = channelModeToSearch(next);
      if (encoded === null) {
        params.delete(CHANNEL_QUERY_KEY);
      } else {
        params.set(CHANNEL_QUERY_KEY, encoded);
      }
      setSearchParams(params, { replace: true });
    },
    [modes, searchParams, setSearchParams],
  );

  return { mode, modes, setMode };
}
