import { describe, expect, it } from "vitest";

import {
  AI_TABS,
  AI_TASKS,
  aiTabForTask,
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
    expect(backendTask("pitch")).toBe("pitch");
    expect(aiTaskFromBackend("neural_codec")).toBe("neural-codec");
    expect(aiTaskFromBackend("beat")).toBe("beat");
    expect(aiTaskFromBackend("unknown")).toBeNull();
  });

  it("shares one sixth tab between pitch and beat while keeping task URLs", () => {
    expect(AI_TABS).toEqual([
      "denoise",
      "superres",
      "separation",
      "asr",
      "neural-codec",
      "pitchBeat",
    ]);
    expect(aiTabForTask("pitch")).toBe("pitchBeat");
    expect(aiTabForTask("beat")).toBe("pitchBeat");
    expect(aiTabForTask("asr")).toBe("asr");
    expect(aiTaskFromSearch("?task=pitch")).toBe("pitch");
    expect(aiTaskFromSearch("?task=beat")).toBe("beat");
  });
});
