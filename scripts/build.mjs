import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import process from "node:process"
import { spawn } from "node:child_process"

const ROOT = process.cwd()
const VITE_CLI = resolve(ROOT, "node_modules/vite/bin/vite.js")

class BuildError extends Error {
  name = "BuildError"
}

async function runVite(target) {
  const child = spawn(process.execPath, [VITE_CLI, "build"], {
    cwd: ROOT,
    env: { ...process.env, BUILD_TARGET: target },
    stdio: "inherit",
  })
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject)
    child.once("exit", resolveExit)
  })
  if (exitCode !== 0) {
    throw new BuildError(`Vite ${target} build exited with ${String(exitCode)}`)
  }
}

async function main() {
  const requestedTarget = process.argv[2]
  const targets = requestedTarget === "eagle" ? ["eagle"] : ["chrome", "eagle"]
  await rm(resolve(ROOT, "dist"), { recursive: true, force: true })
  for (const target of targets) {
    await runVite(target)
  }
  if (targets.includes("chrome")) {
    await mkdir(resolve(ROOT, "dist/chrome"), { recursive: true })
    await copyFile(resolve(ROOT, "src/chrome/manifest.json"), resolve(ROOT, "dist/chrome/manifest.json"))
    // The offscreen document is referenced as "offscreen.html" by the manifest
    // and OFFSCREEN_DOCUMENT_PATH; Vite emits only the bundled script, so the
    // HTML shell is written here with the script path rewritten to the bundle.
    const offscreenHtml = (await readFile(resolve(ROOT, "src/offscreen/index.html"), "utf8")).replace(
      "./offscreen.ts",
      "./offscreen.js",
    )
    await writeFile(resolve(ROOT, "dist/chrome/offscreen.html"), offscreenHtml)
  }
  await mkdir(resolve(ROOT, "dist/eagle-plugin"), { recursive: true })
  await copyFile(
    resolve(ROOT, "eagle-plugin/manifest.json"),
    resolve(ROOT, "dist/eagle-plugin/manifest.json"),
  )
}

await main()
