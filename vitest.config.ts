import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: { enabled: false },
    environment: "node",
    include: ["tests/**/*.test.ts"],
    sequence: { concurrent: false },
    testTimeout: 30_000,
  },
});
