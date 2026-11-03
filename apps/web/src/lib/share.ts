/**
 * Share-by-URL helper (F16): a tool path, its serializable params, and an
 * optional BUNDLED demo id become one stable relative URL. User audio never
 * enters the URL — params are restricted to the locale-free scalar codec and
 * demo ids are validated by the caller against `DEMO_CLIPS`.
 */
import type { DemoClipId } from "../features/input/offline";
import { encodeParams, type UrlParamsInput } from "./url-state";

export type ShareUrlInput = {
  readonly path: string;
  readonly params: UrlParamsInput;
  readonly demoId?: DemoClipId;
};

/** Build a relative share URL with sorted params; the demo id wins over a
 * stale `demo` param already present in `params`. */
export function buildShareUrl({ path, params, demoId }: ShareUrlInput): string {
  const merged: UrlParamsInput = demoId === undefined ? params : { ...params, demo: demoId };
  const query = encodeParams(merged);
  return query === "" ? path : `${path}?${query}`;
}
