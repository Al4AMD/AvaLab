import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The MDCT/STFT golden suites take >5 s on slower Windows CPUs; keep the
    // budget above measured worst-case so the check is not machine-dependent.
    testTimeout: 30_000,
  },
});
