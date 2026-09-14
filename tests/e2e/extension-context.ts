import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { type BrowserContext, chromium } from "@playwright/test"

export type ExtensionContext = {
  readonly context: BrowserContext
  readonly downloadsPath: string
  readonly close: () => Promise<void>
}

export async function launchExtensionContext(extensionPath: string): Promise<ExtensionContext> {
  const profilePath = await mkdtemp(join(tmpdir(), "ai-prompt-image-metadata-playwright-"))
  const downloadsPath = await mkdtemp(join(tmpdir(), "ai-prompt-image-metadata-downloads-"))
  // Chrome resolves --load-extension against its own process working
  // directory, which is not guaranteed to be the test root, so the extension
  // path must be absolute.
  const absoluteExtensionPath = resolve(extensionPath)
  const context = await chromium.launchPersistentContext(profilePath, {
    channel: "chromium",
    headless: true,
    downloadsPath,
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${absoluteExtensionPath}`,
      `--load-extension=${absoluteExtensionPath}`,
    ],
  })
  const cdp = await context.browser()?.newBrowserCDPSession()
  await cdp?.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadsPath,
    eventsEnabled: true,
  })
  return {
    context,
    downloadsPath,
    close: async () => {
      await context.close()
      await rm(profilePath, { recursive: true, force: true })
      await rm(downloadsPath, { recursive: true, force: true })
    },
  }
}
