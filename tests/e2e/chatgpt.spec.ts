import { readFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { launchExtensionContext } from "./extension-context"
import { type FixtureHarness, providerFixture, startFixtureHarness } from "./fixtures"
import {
  findItxtText,
  findTextChunk,
  findXmpItxt,
  listDownloads,
  parsePngChunks,
  readExifMetadata,
  waitForDownload,
  xmpValue,
} from "./png-verify"

const PROVIDER = "chatgpt" as const
const PROMPT = "A red fox in the snow"

test.describe("chatgpt provider flow", () => {
  let harness: FixtureHarness

  test.beforeAll(async () => {
    harness = await startFixtureHarness()
  })

  test.afterAll(async () => {
    await harness.close()
  })

  test("downloads an enriched PNG through the production build", async () => {
    const fixture = providerFixture(PROVIDER)
    const extension = await launchExtensionContext("dist/chrome")
    try {
      const pageBody = await harness.page("chatgpt/success")
      const assetBody = await harness.asset("fixture.png")
      await extension.context.route(`${fixture.origin}/**`, (route) => {
        const url = new URL(route.request().url())
        if (url.pathname === "/backend-api/estuary/content") {
          return route.fulfill({ status: 200, contentType: "image/png", body: assetBody })
        }
        return route.fulfill({ status: 200, contentType: "text/html", body: pageBody })
      })
      const page = await extension.context.newPage()
      const before = await listDownloads(extension.downloadsPath)
      await page.goto(fixture.pagePath("fixture/success"))
      const control = page.locator(".aip2e-download-button")
      const controlWrapper = control.locator("xpath=..")
      await control.waitFor({ state: "attached", timeout: 10_000 })
      await expect(controlWrapper).toHaveCSS("opacity", "0")
      await controlWrapper.locator("xpath=..").hover()
      await expect(controlWrapper).toHaveCSS("opacity", "1")
      expect(
        await control.evaluate((button) => {
          const rect = button.getBoundingClientRect()
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          )
          return hit === button || button.contains(hit)
        }),
      ).toBe(true)
      const nativeDownload = page.getByRole("button", { name: "Download", exact: true })
      const controlBox = await control.boundingBox()
      const nativeBox = await nativeDownload.boundingBox()
      expect(controlBox).not.toBeNull()
      expect(nativeBox).not.toBeNull()
      if (controlBox !== null && nativeBox !== null) {
        expect(controlBox.y + controlBox.height).toBeLessThanOrEqual(nativeBox.y)
      }
      await control.click()
      await expect(page.locator("body")).not.toHaveAttribute("data-viewer-opened", "true")
      await expect(page.locator(".aip2e-dialog")).toHaveCount(0)
      const downloadedPath = await waitForDownload(extension.downloadsPath, before)
      const bytes = await readFile(downloadedPath)
      const chunks = parsePngChunks(new Uint8Array(bytes))
      const pageUrl = fixture.pagePath("fixture/success")
      expect(findTextChunk(chunks, "Source")).toBe(pageUrl)
      // parameters is UTF-8 iTXt so non-Latin-1 prompts survive intact.
      expect(findItxtText(chunks, "parameters")).toBe(PROMPT)
      expect(findTextChunk(chunks, "parameters")).toBeUndefined()
      const xmpChunk = findXmpItxt(chunks)
      expect(xmpChunk).toBeDefined()
      const xmp = Buffer.from(xmpChunk?.data ?? new Uint8Array()).toString("utf8")
      expect(xmpValue(xmp, "AIPromptInformation")).toBe(PROMPT)
      expect(xmpValue(xmp, "AISystemUsed")).toBe("ChatGPT")
      const exifChunk = chunks.find((chunk) => chunk.type === "eXIf")
      expect(exifChunk).toBeDefined()
      expect(exifChunk?.data.slice(0, 8)).toEqual(
        new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
      )
      const exif = readExifMetadata(exifChunk?.data ?? new Uint8Array())
      expect(exif).toEqual({
        imageDescription: PROMPT,
        software: "ChatGPT",
        userComment: PROMPT,
        xpComment: PROMPT,
      })
      // Independent chunk report: original IHDR/IDAT/IEND preserved.
      expect(chunks.map((c) => c.type)).toContain("IHDR")
      expect(chunks.filter((c) => c.type === "IDAT").length).toBeGreaterThanOrEqual(1)
      expect(chunks.at(-1)?.type).toBe("IEND")
      expect(downloadedPath.split(/[\\/]/u).at(-1)).toMatch(/\.png$/u)

      const beforeSecondDownload = await listDownloads(extension.downloadsPath)
      await control.click()
      await expect(
        waitForDownload(extension.downloadsPath, beforeSecondDownload, 5_000),
      ).resolves.toMatch(/\.png$/u)
      await expect(page.locator(".aip2e-status-error")).toHaveCount(0)
    } finally {
      await extension.close()
    }
  })

  test("ambiguous prompt downloads the selected image with one click", async () => {
    const fixture = providerFixture(PROVIDER)
    const extension = await launchExtensionContext("dist/chrome")
    try {
      const pageBody = await harness.page("chatgpt/ambiguous")
      const assetBody = await harness.asset("fixture.png")
      await extension.context.route(`${fixture.origin}/**`, (route) => {
        const url = new URL(route.request().url())
        if (url.pathname.startsWith("/fixture-assets/")) {
          return route.fulfill({ status: 200, contentType: "image/png", body: assetBody })
        }
        return route.fulfill({ status: 200, contentType: "text/html", body: pageBody })
      })
      const page = await extension.context.newPage()
      const before = await listDownloads(extension.downloadsPath)
      await page.goto(fixture.pagePath("fixture/ambiguous"))
      const controls = page.locator(".aip2e-download-button")
      await controls.first().waitFor({ state: "attached", timeout: 10_000 })
      await controls.first().locator("xpath=../..").hover()
      const count = await controls.count()
      expect(count).toBeGreaterThanOrEqual(1)
      await controls.first().click()
      await expect(page.locator(".aip2e-dialog")).toHaveCount(0)
      await expect(waitForDownload(extension.downloadsPath, before)).resolves.toMatch(/\.png$/u)
    } finally {
      await extension.close()
    }
  })

  test("html asset response produces no filesystem output", async () => {
    const fixture = providerFixture(PROVIDER)
    const extension = await launchExtensionContext("dist/chrome")
    try {
      const pageBody = await harness.page("chatgpt/html-asset")
      const htmlAsset = await harness.asset("bad.html")
      await extension.context.route(`${fixture.origin}/**`, (route) => {
        const url = new URL(route.request().url())
        if (url.pathname.startsWith("/fixture-assets/")) {
          return route.fulfill({ status: 200, contentType: "text/html", body: htmlAsset })
        }
        return route.fulfill({ status: 200, contentType: "text/html", body: pageBody })
      })
      const page = await extension.context.newPage()
      await page.goto(fixture.pagePath("fixture/html-asset"))
      const control = page.locator(".aip2e-download-button")
      await control.waitFor({ state: "attached", timeout: 10_000 })
      await control.locator("xpath=../..").hover()
      await control.click()
      // The operation is rejected; the status UI surfaces the error.
      await expect(page.locator(".aip2e-status-error")).toBeVisible({ timeout: 15_000 })
      const entries = await listDownloads(extension.downloadsPath)
      expect(entries.filter((name) => name.endsWith("-ai-prompt.png"))).toHaveLength(0)
    } finally {
      await extension.close()
    }
  })
})
