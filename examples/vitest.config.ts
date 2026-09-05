import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "effect-http-recorder": new URL("../src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["examples/**/*.example.ts"],
    setupFiles: ["examples/setup.ts"],
  },
})
