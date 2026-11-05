import { describe, expect, it } from "vitest";

import { appendSseChunk } from "./sseStream";

describe("appendSseChunk", () => {
  it("normalizes CRLF split across chunk boundaries", () => {
    const first = appendSseChunk("", 'data: {"event":"progress"}\r');
    expect(first).toBe('data: {"event":"progress"}\r');
    const second = appendSseChunk(first, "\n\r\n");
    expect(second).toBe('data: {"event":"progress"}\n\n');
  });

  it("keeps ordinary chunks unchanged", () => {
    expect(appendSseChunk("a\n", "b\n\n")).toBe("a\nb\n\n");
  });
});
