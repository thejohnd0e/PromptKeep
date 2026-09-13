import { resolve } from "node:path"
import process from "node:process"
import { defineConfig } from "vite"

const isEagleBuild = process.env["BUILD_TARGET"] === "eagle"

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: isEagleBuild ? "dist/eagle-plugin" : "dist/chrome",
    rollupOptions: {
      input: isEagleBuild
        ? { main: resolve(import.meta.dirname, "eagle-plugin/src/index.ts") }
        : {
            background: resolve(import.meta.dirname, "src/chrome/background.ts"),
            content: resolve(import.meta.dirname, "src/chrome/content.ts"),
            offscreen: resolve(import.meta.dirname, "src/offscreen/offscreen.ts"),
          },
      output: {
        entryFileNames: "[name].js",
      },
    },
    sourcemap: false,
    target: "es2022",
  },
})
