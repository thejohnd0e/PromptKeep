import { chromium } from "@playwright/test"
import { mkdtempSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { readFile } from "node:fs/promises"

const ext = resolve("dist/chrome")
const profile = mkdtempSync(join(tmpdir(), "probe-flow-"))
const downloadsPath = mkdtempSync(join(tmpdir(), "probe-flow-dl-"))
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  downloadsPath,
  acceptDownloads: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
})

const pageBody = await readFile("tests/fixtures/pages/chatgpt-success.html", "utf8")
const assetBody = await readFile("tests/fixtures/assets/fixture.png")

await context.route("https://chatgpt.com/**", (route) => {
  const url = new URL(route.request().url())
  if (url.pathname.startsWith("/fixture-assets/")) {
    return route.fulfill({ status: 200, contentType: "image/png", body: assetBody })
  }
  return route.fulfill({ status: 200, contentType: "text/html", body: pageBody })
})

const page = await context.newPage()
const consoleMessages = []
page.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text()}`))
page.on("pageerror", (error) => consoleMessages.push(`pageerror: ${String(error)}`))

await page.goto("https://chatgpt.com/fixture/success")
await page.locator(".aip2e-download-button").waitFor({ state: "visible", timeout: 10_000 })
await page.locator(".aip2e-download-button").click()
await page.locator(".aip2e-dialog").waitFor({ state: "visible", timeout: 5_000 })
await page.locator(".aip2e-dialog-confirm").click()

// Wait for the flow to settle.
await new Promise((resolve) => setTimeout(resolve, 6000))

const status = await page.evaluate(() => {
  const statusEl = document.querySelector(".aip2e-status")
  return statusEl === null ? null : statusEl.textContent
})
console.log("status UI:", JSON.stringify(status))

let sw = context.serviceWorkers()[0]
if (sw === undefined) {
  sw = await context.waitForEvent("serviceworker", { timeout: 5_000 })
}
const swState = await sw.evaluate(async () => {
  const items = await chrome.downloads.search({ limit: 10 })
  return items.map((item) => ({
    id: item.id,
    state: item.state,
    url: item.url?.slice(0, 60),
    filename: item.filename,
    error: item.error,
  }))
})
console.log("chrome.downloads state:", JSON.stringify(swState, null, 1))
console.log("downloadsPath contents:", readdirSync(downloadsPath))
console.log("console:", consoleMessages.slice(0, 12))

await context.close()
