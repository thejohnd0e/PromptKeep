import { readFile, readdir } from "node:fs/promises"
import { resolve } from "node:path"
import process from "node:process"

const ROOT = process.cwd()
const REQUIRED_FILES = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
  "playwright.config.ts",
  "biome.json",
  "scripts/build.mjs",
  "src/shared/contracts.ts",
  "src/chrome/background.ts",
  "src/chrome/content.ts",
  "src/chrome/manifest.json",
  "eagle-plugin/src/index.ts",
  "eagle-plugin/manifest.json",
]

const REQUIRED_SCRIPTS = [
  "typecheck",
  "lint",
  "test:unit",
  "test:property",
  "test:compat",
  "build",
  "test:e2e",
  "test:eagle",
  "verify:workspace",
  "verify",
]

const EXECUTABLE_PATTERN = /(?:\bimport\s*\(\s*["']https?:|\bimportScripts\s*\(\s*["']https?:|\beval\s*\(|\bnew\s+Function\s*\(|WebAssembly\.(?:instantiate|compile)Streaming\s*\()/u

class VerificationError extends Error {
  name = "VerificationError"
}

async function readText(relativePath) {
  return readFile(resolve(ROOT, relativePath), "utf8")
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath))
}

function requireCondition(condition, message) {
  if (!condition) {
    throw new VerificationError(message)
  }
}

async function filesBelow(relativePath) {
  const entries = await readdir(resolve(ROOT, relativePath), { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const child = `${relativePath}/${entry.name}`
      return entry.isDirectory() ? filesBelow(child) : [child]
    }),
  )
  return nested.flat()
}

function executableReferences(manifest) {
  const references = []
  if (typeof manifest.background?.service_worker === "string") {
    references.push(manifest.background.service_worker)
  }
  for (const contentScript of manifest.content_scripts ?? []) {
    references.push(...(contentScript.js ?? []))
  }
  if (typeof manifest.main === "string") {
    references.push(manifest.main)
  }
  return references
}

function verifyManifest(manifest, label) {
  for (const reference of executableReferences(manifest)) {
    requireCondition(
      typeof reference === "string" && !/^https?:\/\//u.test(reference),
      `${label} contains remote executable code: ${String(reference)}`,
    )
  }
  const extensionPages = manifest.content_security_policy?.extension_pages
  if (typeof extensionPages === "string") {
    requireCondition(!/(?:https?:|unsafe-eval|wasm-unsafe-eval)/u.test(extensionPages), `${label} has unsafe CSP`)
  }
}

async function verifyPackage() {
  const packageJson = await readJson("package.json")
  requireCondition(packageJson.engines?.node === ">=22.12.0", "Node engine must be >=22.12.0")
  requireCondition(/^npm@\d+\.\d+\.\d+$/u.test(packageJson.packageManager ?? ""), "npm must be pinned")
  for (const script of REQUIRED_SCRIPTS) {
    requireCondition(typeof packageJson.scripts?.[script] === "string", `missing script: ${script}`)
  }
  for (const section of [packageJson.dependencies ?? {}, packageJson.devDependencies ?? {}]) {
    for (const [name, version] of Object.entries(section)) {
      requireCondition(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version), `${name} is not exactly pinned`)
    }
  }
  const packageLock = await readJson("package-lock.json")
  requireCondition(packageLock.lockfileVersion === 3, "package-lock.json must use lockfileVersion 3")
}

async function verifySources() {
  const sourceFiles = (await Promise.all([filesBelow("src"), filesBelow("eagle-plugin/src")]))
    .flat()
    .filter((path) => /\.[jt]s$/u.test(path))
  for (const sourceFile of sourceFiles) {
    const lines = (await readText(sourceFile)).split(/\r?\n/u)
    const logicalLines = lines.filter((line) => line.trim() !== "" && !line.trimStart().startsWith("//")).length
    requireCondition(logicalLines <= 250, `${sourceFile} has ${logicalLines} logical lines`)
    console.log(`source-size ${sourceFile}: ${logicalLines}/250`)
  }
}

async function verifyBuild() {
  const roots = await readdir(resolve(ROOT, "dist"), { withFileTypes: true })
  requireCondition(
    roots.every((entry) => entry.isDirectory() && ["chrome", "eagle-plugin"].includes(entry.name)),
    "dist contains an unexpected build target",
  )
  const chromeManifest = await readJson("dist/chrome/manifest.json")
  const eagleManifest = await readJson("dist/eagle-plugin/manifest.json")
  requireCondition(chromeManifest.manifest_version === 3, "Chrome target must use Manifest V3")
  requireCondition(eagleManifest.type === "inspector", "Eagle target must be an inspector")
  verifyManifest(chromeManifest, "Chrome manifest")
  verifyManifest(eagleManifest, "Eagle manifest")
  for (const target of ["dist/chrome", "dist/eagle-plugin"]) {
    for (const file of await filesBelow(target)) {
      if (/\.m?js$/u.test(file)) {
        requireCondition(!EXECUTABLE_PATTERN.test(await readText(file)), `${file} contains forbidden executable code`)
      }
    }
  }
}

async function main() {
  await Promise.all(REQUIRED_FILES.map((file) => readText(file)))
  await verifyPackage()
  await verifySources()
  await verifyBuild()
  const fixtureManifest = process.env.VERIFY_MANIFEST_PATH
  if (fixtureManifest !== undefined) {
    verifyManifest(await readJson(fixtureManifest), "Fixture manifest")
  }
  console.log(`workspace verified with Node ${process.version}`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
