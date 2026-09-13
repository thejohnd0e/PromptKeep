import { access, readFile, readdir } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import process from "node:process"

const ROOT = process.cwd()
const DIST = resolve(ROOT, "dist/eagle-plugin")

class VerificationError extends Error {
  name = "VerificationError"
}

function requireCondition(condition, message) {
  if (!condition) {
    throw new VerificationError(message)
  }
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function filesBelow(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const child = resolve(dir, entry.name)
      return entry.isDirectory() ? filesBelow(child) : [child]
    }),
  )
  return nested.flat()
}

async function main() {
  const manifest = JSON.parse(await readFile(resolve(DIST, "manifest.json"), "utf8"))
  requireCondition(manifest.type === "inspector", "manifest type must be inspector")
  requireCondition(
    Array.isArray(manifest.files) && manifest.files.includes("png"),
    "manifest must register png files",
  )
  requireCondition(manifest.singleSelect === true, "manifest must declare single-select-only")
  requireCondition(typeof manifest.main === "string", "manifest main must be a string")
  const mainPath = resolve(DIST, manifest.main)
  const mainRelative = relative(DIST, mainPath)
  requireCondition(
    !mainRelative.startsWith("..") && !isAbsolute(mainRelative),
    "manifest main must resolve inside dist/eagle-plugin",
  )
  requireCondition(await pathExists(mainPath), `manifest main does not resolve: ${manifest.main}`)

  const jsFiles = (await filesBelow(DIST)).filter((file) => /\.m?js$/u.test(file))
  requireCondition(jsFiles.length > 0, "no built JavaScript files found")
  for (const file of jsFiles) {
    const source = await readFile(file, "utf8")
    requireCondition(!/https?:\/\//u.test(source), `${file} contains a remote asset reference`)
  }
  console.log(`eagle package verified: ${jsFiles.length} JS file(s), no remote assets`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}