import { chromium } from "@playwright/test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readFile } from "node:fs/promises"

const ext = join(process.cwd(), "dist/chrome")
const profile = mkdtempSync(join(tmpdir(), "probe-visible-"))
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

const info = await page.evaluate(() => {
  const button = document.querySelector(".aip2e-download-button")
  if (button === null) return { present: false }
  const rect = button.getBoundingClientRect()
  const style = getComputedStyle(button)
  const control = button.closest(".aip2e-control")
  const controlStyle = control === null ? null : getComputedStyle(control)
  return {
    present: true,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    display: style.display,
    visibility: style.visibility,
    controlDisplay: controlStyle?.display,
    controlPosition: controlStyle?.position,
    parentTag: button.parentElement?.parentElement?.tagName,
    disabled: button.disabled,
  }
})
console.log("button info:", JSON.stringify(info, null, 1))
console.log("console:", consoleMessages.slice(0, 10))

await context.close()
