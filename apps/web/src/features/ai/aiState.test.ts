import { describe, expect, it } from "vitest";

import {
  AI_TASKS,
  aiTaskFromBackend,
  aiTaskFromSearch,
  aiTaskToSearch,
  backendTask,
} from "./aiState";

describe("AI task URL state", () => {
  it("parses known tasks with or without a leading question mark", () => {
    expect(aiTaskFromSearch("?task=asr")).toBe("asr");
    expect(aiTaskFromSearch("task=neural-codec")).toBe("neural-codec");
    expect(aiTaskFromSearch("?task=superres")).toBe("superres");
  });

  it("falls back to denoise for missing or unknown tasks", () => {
    expect(aiTaskFromSearch("")).toBe("denoise");
    expect(aiTaskFromSearch("?task=bogus")).toBe("denoise");
    expect(aiTaskFromSearch("?task=neural_codec")).toBe("denoise");
  });

  it("round-trips every task", () => {
    for (const task of AI_TASKS) {
      expect(aiTaskFromSearch(aiTaskToSearch(task))).toBe(task);
    }
  });

  it("maps public task ids to backend ids and back", () => {
    expect(backendTask("neural-codec")).toBe("neural_codec");
    expect(backendTask("denoise")).toBe("denoise");
    expect(aiTaskFromBackend("neural_codec")).toBe("neural-codec");
    expect(aiTaskFromBackend("unknown")).toBeNull();
  });
});
