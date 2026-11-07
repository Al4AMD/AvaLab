import { describe, expect, it } from "vitest";

import { aiRunDisabled } from "./aiLabView";

const READY = {
  mlEnabled: true,
  hasSource: true,
  backendOnline: true,
  modelState: "available" as const,
  busy: false,
};

describe("AI run gating", () => {
  it("disables the run control when the backend reports ml_enabled false", () => {
    expect(aiRunDisabled({ ...READY, mlEnabled: false })).toBe(true);
  });

  it("enables the run control only when every prerequisite is ready", () => {
    expect(aiRunDisabled(READY)).toBe(false);
    expect(aiRunDisabled({ ...READY, hasSource: false })).toBe(true);
    expect(aiRunDisabled({ ...READY, backendOnline: false })).toBe(true);
    expect(aiRunDisabled({ ...READY, modelState: "missing" })).toBe(true);
    expect(aiRunDisabled({ ...READY, busy: true })).toBe(true);
  });
});
