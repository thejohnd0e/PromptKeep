import { chromium } from "@playwright/test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ext = join(process.cwd(), "dist/chrome")
const profile = mkdtempSync(join(tmpdir(), "probe-offscreen-v5-"))
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
})

let sw = context.serviceWorkers()[0]
if (sw === undefined) {
  sw = await context.waitForEvent("serviceworker", { timeout: 10_000 })
}

await sw.evaluate(async () => {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"],
      justification: "probe",
    })
  }
})

// Attach to the offscreen target with flatten:true, then drive the session
// through a dedicated CDP connection created from the browser endpoint using
// Target.attachToTarget + raw websocket semantics. Playwright's CDPSession
// routes flattened session messages when the session was created from the
// same connection, so we use Target.sendMessageToTarget WITHOUT flatten and
// parse Target.receivedMessageFromTarget instead.
const browser = context.browser()
const cdpBrowser = await browser.newBrowserCDPSession()
const { targetInfos } = await cdpBrowser.send("Target.getTargets")
const offscreen = targetInfos.find((t) => t.url.includes("offscreen.html"))
if (offscreen === undefined) {
  console.log("offscreen target NOT found; targets:", targetInfos.map((t) => `${t.type}:${t.url}`))
} else {
  const replyPromise = new Promise((resolve) => {
    const handler = (event) => {
      if (event.targetId === offscreen.targetId) {
        cdpBrowser.off("Target.receivedMessageFromTarget", handler)
        resolve(JSON.parse(event.message))
      }
    }
    cdpBrowser.on("Target.receivedMessageFromTarget", handler)
  })
  // No flatten: Target.sendMessageToTarget routes by targetId.
  await cdpBrowser.send("Target.attachToTarget", { targetId: offscreen.targetId })
  await cdpBrowser.send("Target.sendMessageToTarget", {
    targetId: offscreen.targetId,
    message: JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        returnByValue: true,
        expression: `(() => ({
          hasRuntime: typeof chrome?.runtime !== "undefined",
          hasDownloads: typeof chrome?.downloads !== "undefined",
          hasDownloadFn: typeof chrome?.downloads?.download === "function",
          hasOnChanged: typeof chrome?.downloads?.onChanged?.addListener === "function",
          hasStorage: typeof chrome?.storage !== "undefined",
          hasOffscreen: typeof chrome?.offscreen !== "undefined",
        }))()`,
      },
    }),
  })
  const reply = await replyPromise
  console.log("offscreen API surface:", JSON.stringify(reply.result?.result?.value, null, 1))
}

await context.close()
