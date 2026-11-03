import { describe, expect, it } from "vitest";

import { createDemoDeepLinkTracker, demoIdFromSearch } from "./demoDeepLink";

describe("demoIdFromSearch", () => {
  it("accepts every bundled clip id from a query string", () => {
    expect(demoIdFromSearch("?demo=chirp")).toBe("chirp");
    expect(demoIdFromSearch("demo=speech")).toBe("speech");
    expect(demoIdFromSearch("?task=superres&demo=music")).toBe("music");
  });

  it("returns null for missing, empty, or unknown demo ids", () => {
    expect(demoIdFromSearch("")).toBeNull();
    expect(demoIdFromSearch("?demo=")).toBeNull();
    expect(demoIdFromSearch("?demo=unknown")).toBeNull();
    expect(demoIdFromSearch("?task=asr")).toBeNull();
  });
});

describe("demo deep-link tracker", () => {
  it("loads once per navigation key", () => {
    const tracker = createDemoDeepLinkTracker();
    expect(tracker.take({ search: "?demo=chirp", navigationKey: "nav-1", hasSource: false })).toBe(
      "chirp",
    );
    expect(
      tracker.take({ search: "?demo=chirp", navigationKey: "nav-1", hasSource: false }),
    ).toBeNull();
    expect(tracker.take({ search: "?demo=music", navigationKey: "nav-2", hasSource: false })).toBe(
      "music",
    );
  });

  it("never loads over an existing source", () => {
    const tracker = createDemoDeepLinkTracker();
    expect(tracker.take({ search: "?demo=speech", navigationKey: "nav-1", hasSource: true })).toBe(
      null,
    );
    expect(tracker.take({ search: "?demo=speech", navigationKey: "nav-1", hasSource: false })).toBe(
      "speech",
    );
  });

  it("ignores an invalid demo without consuming the navigation", () => {
    const tracker = createDemoDeepLinkTracker();
    expect(tracker.take({ search: "?demo=nope", navigationKey: "nav-1", hasSource: false })).toBe(
      null,
    );
    expect(tracker.take({ search: "?demo=chirp", navigationKey: "nav-1", hasSource: false })).toBe(
      "chirp",
    );
  });
});
