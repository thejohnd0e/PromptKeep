import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: false,
    testTimeout: 5_000,
    include: ["tests/**/*.test.ts"],
  },
})
