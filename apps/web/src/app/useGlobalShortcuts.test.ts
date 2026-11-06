import { describe, expect, it } from "vitest";

import { isEditableTarget, resolveShortcut, type ShortcutEvent } from "./useGlobalShortcuts";

function targetMatching(selectorPart: string | null): EventTarget {
  return {
    closest: (selector: string) =>
      selectorPart !== null && selector.includes(selectorPart) ? {} : null,
  } as unknown as EventTarget;
}

function event(overrides: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return {
    key: " ",
    target: targetMatching(null),
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    ...overrides,
  };
}

describe("isEditableTarget", () => {
  it("accepts input/textarea/select/contenteditable/dialog descendants", () => {
    for (const selectorPart of [
      "input",
      "textarea",
      "select",
      '[contenteditable="true"]',
      '[role="dialog"]',
    ]) {
      expect(isEditableTarget(targetMatching(selectorPart))).toBe(true);
    }
  });

  it("rejects ordinary targets", () => {
    expect(isEditableTarget(targetMatching(null))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({} as EventTarget)).toBe(false);
  });

  it("is total when closest throws", () => {
    expect(
      isEditableTarget({
        closest: () => {
          throw new Error("detached");
        },
      } as unknown as EventTarget),
    ).toBe(false);
  });
});

describe("resolveShortcut", () => {
  it("maps Space and arrows with the Shift jump", () => {
    expect(resolveShortcut(event({ key: " " }), true)).toEqual({ kind: "togglePlay" });
    expect(resolveShortcut(event({ key: "ArrowLeft" }), true)).toEqual({
      kind: "seek",
      deltaSeconds: -5,
    });
    expect(resolveShortcut(event({ key: "ArrowRight" }), true)).toEqual({
      kind: "seek",
      deltaSeconds: 5,
    });
    expect(resolveShortcut(event({ key: "ArrowLeft", shiftKey: true }), true)).toEqual({
      kind: "seek",
      deltaSeconds: -10,
    });
    expect(resolveShortcut(event({ key: "ArrowRight", shiftKey: true }), true)).toEqual({
      kind: "seek",
      deltaSeconds: 10,
    });
  });

  it("opens help with ? even without a source", () => {
    expect(resolveShortcut(event({ key: "?" }), false)).toEqual({ kind: "showHelp" });
  });

  it("does nothing for play/seek without a source", () => {
    expect(resolveShortcut(event({ key: " " }), false)).toBeNull();
    expect(resolveShortcut(event({ key: "ArrowLeft" }), false)).toBeNull();
  });

  it("ignores editable targets, repeats, and modifier chords", () => {
    expect(resolveShortcut(event({ target: targetMatching("input") }), true)).toBeNull();
    expect(
      resolveShortcut(event({ key: "?", target: targetMatching('[role="dialog"]') }), true),
    ).toBeNull();
    expect(resolveShortcut(event({ repeat: true }), true)).toBeNull();
    expect(resolveShortcut(event({ ctrlKey: true }), true)).toBeNull();
    expect(resolveShortcut(event({ metaKey: true }), true)).toBeNull();
    expect(resolveShortcut(event({ altKey: true }), true)).toBeNull();
    expect(resolveShortcut(event({ key: "?", ctrlKey: true }), true)).toBeNull();
  });

  it("ignores unrelated keys", () => {
    expect(resolveShortcut(event({ key: "a" }), true)).toBeNull();
  });
});
