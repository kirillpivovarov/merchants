import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      include: ["core/**/*.mjs", "server/scanner.mjs", "server/store.mjs"],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 65 },
      reporter: ["text", "json-summary", "html"],
    },
  },
});
