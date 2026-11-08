import type { ChannelLaneId } from "../../lib/channel";

export function channelLabel(t: (key: string) => string, id: ChannelLaneId): string {
  switch (id) {
    case "mono":
      return t("channel.mono");
    case "left":
      return t("channel.left");
    case "right":
      return t("channel.right");
  }
}
