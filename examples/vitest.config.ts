import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["examples/github.example.ts"],
  },
})
