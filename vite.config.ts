import { resolve } from "node:path"
import process from "node:process"
import { defineConfig } from "vite"

// BUILD_TARGET=content builds the content script alone as a self-contained
// IIFE: Chrome injects content scripts as classic scripts, so the bundle must
// not contain import statements.
const isContentBuild = process.env["BUILD_TARGET"] === "content"

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: "dist/chrome",
    sourcemap: false,
    target: "es2022",
    rollupOptions: isContentBuild
      ? {
          input: { content: resolve(import.meta.dirname, "src/chrome/content.ts") },
          output: {
            entryFileNames: "content.js",
            format: "iife",
            inlineDynamicImports: true,
          },
        }
      : {
          input: {
            background: resolve(import.meta.dirname, "src/chrome/background.ts"),
            offscreen: resolve(import.meta.dirname, "src/offscreen/offscreen.ts"),
          },
          output: { entryFileNames: "[name].js", chunkFileNames: "assets/[name]-[hash].js" },
        },
  },
})
