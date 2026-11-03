/**
 * Demo deep links (F16): `?demo=<id>` loads a bundled clip once per
 * navigation. Unknown ids are ignored (the page stays on its empty state),
 * an existing source is never replaced, and the URL is left untouched so the
 * link stays shareable after the clip settles.
 */
import { DEMO_CLIPS, type DemoClipId } from "./offline";

const DEMO_IDS: ReadonlySet<string> = new Set(DEMO_CLIPS.map((clip) => clip.id));

/** Validated demo id from a query string, or null when absent/unknown. */
export function demoIdFromSearch(search: string): DemoClipId | null {
  const value = new URLSearchParams(search).get("demo");
  if (value === null || !DEMO_IDS.has(value)) {
    return null;
  }
  return value as DemoClipId;
}

export type DemoDeepLinkQuery = {
  readonly search: string;
  readonly navigationKey: string;
  readonly hasSource: boolean;
};

export type DemoDeepLinkTracker = {
  /** Returns a demo to load exactly once per navigation key; null otherwise. */
  take(query: DemoDeepLinkQuery): DemoClipId | null;
};

/** Per-mount guard for effect-driven loading (React StrictMode safe: the
 * same navigation key never loads twice). */
export function createDemoDeepLinkTracker(): DemoDeepLinkTracker {
  let lastNavigationKey: string | null = null;
  return {
    take({ search, navigationKey, hasSource }) {
      if (hasSource || navigationKey === lastNavigationKey) {
        return null;
      }
      const demoId = demoIdFromSearch(search);
      if (demoId === null) {
        return null;
      }
      lastNavigationKey = navigationKey;
      return demoId;
    },
  };
}
