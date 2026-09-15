import { readFile } from "node:fs/promises"
import { join } from "node:path"
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

const PROVIDER = "gemini" as const
const PROMPT = "A watercolor lighthouse"

function pngSize(chunks: readonly { readonly type: string; readonly data: Uint8Array }[]): {
  readonly width: number
  readonly height: number
} {
  const ihdr = chunks.find((chunk) => chunk.type === "IHDR")
  if (ihdr === undefined) throw new Error("PNG is missing IHDR")
  const view = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength)
  return { width: view.getUint32(0, false), height: view.getUint32(4, false) }
}

test.describe("gemini provider flow", () => {
  let harness: FixtureHarness

  test.beforeAll(async () => {
    harness = await startFixtureHarness()
  })

  test.afterAll(async () => {
    await harness.close()
  })

  test("downloads the full-size href instead of the rendered thumbnail", async () => {
    const fixture = providerFixture(PROVIDER)
    const extension = await launchExtensionContext("dist/chrome")
    try {
      const pageBody = await harness.page("gemini/success")
      const assetBody = await harness.asset("fixture.png")
      const htmlAsset = await harness.asset("bad.html")
      await extension.context.route(`${fixture.origin}/**`, (route) => {
        const url = new URL(route.request().url())
        if (url.pathname === "/fixture-assets/fixture.png") {
          return route.fulfill({ status: 200, contentType: "image/png", body: assetBody })
        }
        if (url.pathname.startsWith("/fixture-assets/")) {
          return route.fulfill({ status: 200, contentType: "text/html", body: htmlAsset })
        }
        return route.fulfill({ status: 200, contentType: "text/html", body: pageBody })
      })
      const page = await extension.context.newPage()
      const before = await listDownloads(extension.downloadsPath)
      await page.goto(fixture.pagePath("fixture/success"))
      const control = page.locator(".aip2e-download-button")
      const controlWrapper = control.locator("xpath=..")
      await control.waitFor({ state: "attached", timeout: 10_000 })
      await expect(controlWrapper).toHaveCSS("top", "44px")
      await expect(controlWrapper).toHaveCSS("right", "8px")
      await controlWrapper.locator("xpath=..").hover()
      await control.click()
      const downloadedPath = await waitForDownload(extension.downloadsPath, before)
      const bytes = await readFile(downloadedPath)
      const chunks = parsePngChunks(new Uint8Array(bytes))
      expect(findTextChunk(chunks, "Source")).toBe(fixture.pagePath("fixture/success"))
      expect(findItxtText(chunks, "parameters")).toBe(PROMPT)
      const xmpChunk = findXmpItxt(chunks)
      expect(xmpChunk).toBeDefined()
      const xmp = Buffer.from(xmpChunk?.data ?? new Uint8Array()).toString("utf8")
      expect(xmpValue(xmp, "AIPromptInformation")).toBe(PROMPT)
      expect(xmpValue(xmp, "AISystemUsed")).toBe("Google Gemini")
      const exifChunk = chunks.find((chunk) => chunk.type === "eXIf")
      expect(exifChunk).toBeDefined()
      const exif = readExifMetadata(exifChunk?.data ?? new Uint8Array())
      expect(exif).toEqual({
        imageDescription: PROMPT,
        software: "Google Gemini",
        userComment: PROMPT,
        xpComment: PROMPT,
      })
      await expect(page.locator(".aip2e-status")).toHaveCount(0)
    } finally {
      await extension.close()
    }
  })

  for (const mode of ["direct", "sandbox"] as const) {
    test(`downloads one full-size PNG with prompt from a ${mode} Gemini download`, async () => {
      const fixture = providerFixture(PROVIDER)
      const extension = await launchExtensionContext("dist/chrome")
      try {
        const pageBody = await readFile(
          join("tests", "fixtures", "pages", "gemini-blob.html"),
          "utf8",
        )
        await extension.context.route(`${fixture.origin}/**`, (route) =>
          route.fulfill({ status: 200, contentType: "text/html", body: pageBody }),
        )
        const page = await extension.context.newPage()
        const before = await listDownloads(extension.downloadsPath)
        const pageUrl = fixture.pagePath(
          mode === "sandbox" ? "fixture/blob?sandbox" : "fixture/blob",
        )
        await page.goto(pageUrl)
        const control = page.locator(".aip2e-download-button")
        await control.waitFor({ state: "attached", timeout: 10_000 })
        await control.locator("xpath=..").locator("xpath=..").hover()
        await control.click()
        const downloadedPath = await waitForDownload(extension.downloadsPath, before)
        const bytes = await readFile(downloadedPath)
        const chunks = parsePngChunks(new Uint8Array(bytes))
        expect(pngSize(chunks)).toEqual(
          mode === "sandbox" ? { width: 1792, height: 2400 } : { width: 96, height: 160 },
        )
        expect(findTextChunk(chunks, "Source")).toBe(pageUrl)
        expect(findItxtText(chunks, "parameters")).toBe(PROMPT)
        const exifChunk = chunks.find((chunk) => chunk.type === "eXIf")
        expect(readExifMetadata(exifChunk?.data ?? new Uint8Array()).userComment).toBe(PROMPT)
        const xmp = Buffer.from(findXmpItxt(chunks)?.data ?? new Uint8Array()).toString("utf8")
        expect(xmpValue(xmp, "AIPromptInformation")).toBe(PROMPT)
        if (mode === "sandbox") {
          await expect(page.locator("#gemini-download")).toHaveAttribute("data-completed", "true")
        }
        await expect(page.locator(".aip2e-status")).toHaveCount(0)
        expect(
          (await listDownloads(extension.downloadsPath)).filter((file) => !before.includes(file)),
        ).toHaveLength(1)
      } finally {
        await extension.close()
      }
    })
  }
})
