import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import process from "node:process"

const MANIFEST_PATH = resolve(process.cwd(), "dist/chrome/manifest.json")

const EXPECTED_PERMISSIONS = ["storage", "downloads", "offscreen"]
const EXPECTED_HOST_PERMISSIONS = [
  "https://chatgpt.com/*",
  "https://gemini.google.com/*",
  "https://grok.com/*",
  "https://*.googleusercontent.com/*",
]
const FORBIDDEN_PERMISSIONS = ["debugger", "cookies", "webRequest", "nativeMessaging"]
const FORBIDDEN_HOST_PATTERNS = ["<all_urls>", "*://*/*", "http://*/*", "https://*/*"]

class ManifestVerificationError extends Error {
  name = "ManifestVerificationError"
}

function assertEqualSets(actual, expected, label) {
  const actualSorted = [...actual].sort()
  const expectedSorted = [...expected].sort()
  if (actualSorted.length !== expectedSorted.length) {
    throw new ManifestVerificationError(
      `${label} mismatch: expected ${JSON.stringify(expectedSorted)}, got ${JSON.stringify(actualSorted)}`,
    )
  }
  for (let index = 0; index < actualSorted.length; index += 1) {
    if (actualSorted[index] !== expectedSorted[index]) {
      throw new ManifestVerificationError(
        `${label} mismatch: expected ${JSON.stringify(expectedSorted)}, got ${JSON.stringify(actualSorted)}`,
      )
    }
  }
}

function assertNoForbidden(actual, forbidden, label) {
  for (const entry of actual) {
    if (forbidden.includes(entry)) {
      throw new ManifestVerificationError(`${label} contains forbidden entry: ${entry}`)
    }
  }
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"))

  if (manifest.manifest_version !== 3) {
    throw new ManifestVerificationError("manifest_version must be 3")
  }

  const permissions = manifest.permissions ?? []
  assertEqualSets(permissions, EXPECTED_PERMISSIONS, "permissions")
  assertNoForbidden(permissions, FORBIDDEN_PERMISSIONS, "permissions")

  const hostPermissions = manifest.host_permissions ?? []
  assertEqualSets(hostPermissions, EXPECTED_HOST_PERMISSIONS, "host_permissions")
  assertNoForbidden(hostPermissions, FORBIDDEN_HOST_PATTERNS, "host_permissions")

  const csp = manifest.content_security_policy?.extension_pages ?? ""
  if (!/script-src 'self'/u.test(csp) || /https?:/u.test(csp)) {
    throw new ManifestVerificationError(`extension_pages CSP must be script-src 'self' with no remote sources: ${csp}`)
  }

  const offscreen = manifest.offscreen
  if (offscreen?.path !== "offscreen.html" || offscreen?.reason !== "BLOBS") {
    throw new ManifestVerificationError(`offscreen section must be { path: "offscreen.html", reason: "BLOBS" }`)
  }

  const background = manifest.background
  if (background?.service_worker !== "background.js" || background?.type !== "module") {
    throw new ManifestVerificationError("background must be a module service worker at background.js")
  }

  const contentScripts = manifest.content_scripts ?? []
  const matches = contentScripts.flatMap((script) => script.matches ?? [])
  assertEqualSets(matches, ["https://chatgpt.com/*", "https://gemini.google.com/*", "https://grok.com/*"], "content_scripts matches")

  console.log("verify-manifest: OK")
}

await main()