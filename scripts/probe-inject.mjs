import { chromium } from "@playwright/test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readFile } from "node:fs/promises"

const ext = join(process.cwd(), "dist/chrome")
const profile = mkdtempSync(join(tmpdir(), "probe-inject-"))
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
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
await new Promise((resolve) => setTimeout(resolve, 3000))

const dom = await page.evaluate(() => ({
  url: location.href,
  hasImg: document.querySelector("img") !== null,
  imgSrc: document.querySelector("img")?.getAttribute("src"),
  hasTurn1: document.querySelector("[data-testid='conversation-turn-1']") !== null,
  hasAssistant: document.querySelector("[data-message-author-role='assistant']") !== null,
  hasControl: document.querySelector(".aip2e-control") !== null,
  hasButton: document.querySelector(".aip2e-download-button") !== null,
  bodyChildren: document.body.children.length,
}))
console.log("DOM:", JSON.stringify(dom, null, 1))
console.log("console:", consoleMessages.slice(0, 10))

await context.close()
