import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type BrowserContext, chromium } from "@playwright/test"

export type ExtensionContext = {
  readonly context: BrowserContext
  readonly close: () => Promise<void>
}

export async function launchExtensionContext(extensionPath: string): Promise<ExtensionContext> {
  const profilePath = await mkdtemp(join(tmpdir(), "ai-prompt-image-metadata-playwright-"))
  const context = await chromium.launchPersistentContext(profilePath, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })
  return {
    context,
    close: async () => {
      await context.close()
      await rm(profilePath, { recursive: true, force: true })
    },
  }
}
