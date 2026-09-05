import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["examples/**", "node_modules/**"],
    testTimeout: 30_000,
  },
})
