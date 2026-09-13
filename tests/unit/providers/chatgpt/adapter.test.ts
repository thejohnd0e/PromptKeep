import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  captureChatGptTurn,
  captureProvisionalPrompt,
  reconcileUserTurn,
} from "../../../../src/providers/chatgpt/adapter"
import { CHATGPT_SELECTORS_VERSION } from "../../../../src/providers/chatgpt/selectors"
import { promptCaptureId, unixMilliseconds } from "../../../../src/shared/contracts"
import { parseFixtureDocument } from "../html-fixture"

const NOW = unixMilliseconds(1_700_000_000_000)
const CAPTURE_ID = promptCaptureId("chatgpt:test-capture")

function fixture(name: string) {
  const html = readFileSync(`tests/fixtures/providers/chatgpt/${name}.html`, "utf8")
  return parseFixtureDocument(html) as unknown as Document
}

const PROMPT = "A red fox in the snow"

describe("chatgpt adapter", () => {
  it("pins the selectors version", () => {
    expect(CHATGPT_SELECTORS_VERSION).toBe(1)
  })

  it("success-current-turn: reconciles prompt and classifies one proven image", () => {
    const doc = fixture("success-current-turn")
    const result = captureChatGptTurn(doc, PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.promptCapture.originalPrompt).toBe(PROMPT)
    expect(result.promptCapture.providerTurnId).toBe("chatgpt:conversation-turn-2")
    expect(result.association).toBe("provider_identity")
    expect(result.images.length).toBe(1)
    expect(result.images[0]?.candidate.sourceUrl).toContain("oaiusercontent.com")
    expect(result.images[0]?.hasDownloadControl).toBe(true)
  })

  it("historical-turn: matches the prompt in an earlier visible turn", () => {
    const doc = fixture("historical-turn")
    const result = captureChatGptTurn(doc, PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.promptCapture.providerTurnId).toBe("chatgpt:conversation-turn-4")
  })

  it("two-images: classifies both images with controls", () => {
    const doc = fixture("two-images")
    const result = captureChatGptTurn(doc, "Two foxes", NOW, CAPTURE_ID)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.images.length).toBe(2)
    expect(result.association).toBe("provider_identity")
  })

  it("regenerated-branch: binds to the latest matching turn", () => {
    const doc = fixture("regenerated-branch")
    const result = captureChatGptTurn(doc, PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.promptCapture.providerTurnId).toBe("chatgpt:conversation-turn-4")
    expect(result.images[0]?.candidate.sourceUrl).toContain("fox-v2")
  })

  it("lazy-image: image without src still classified but requires confirmation", () => {
    const doc = fixture("lazy-image")
    const result = captureChatGptTurn(doc, PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.association).toBe("confirmation_required")
  })

  it("upload-exclusion: user uploads are never classified as generated", () => {
    const doc = fixture("upload-exclusion")
    const result = captureChatGptTurn(doc, "Look at this photo", NOW, CAPTURE_ID)
    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.reason).toBe("no_images")
  })

  it("missing-prompt: no matching user turn rejects", () => {
    const doc = fixture("missing-prompt")
    const result = captureChatGptTurn(doc, PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("rejected")
  })

  it("changed-selector: assistant turn without role attribute yields no images", () => {
    const doc = fixture("changed-selector")
    const result = captureChatGptTurn(doc, PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.reason).toBe("no_images")
  })

  it("non-png-asset: jpeg asset still classified by URL (download layer enforces signature)", () => {
    const doc = fixture("non-png-asset")
    const result = captureChatGptTurn(doc, PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.images[0]?.candidate.sourceUrl).toContain(".jpg")
  })

  it("ambiguous-identity: two identical user turns bind to the latest, never auto-merge", () => {
    const doc = fixture("ambiguous-identity")
    const result = captureChatGptTurn(doc, PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.promptCapture.providerTurnId).toBe("chatgpt:conversation-turn-4")
  })

  it("empty prompt is rejected", () => {
    const doc = fixture("success-current-turn")
    const result = captureChatGptTurn(doc, "   ", NOW, CAPTURE_ID)
    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.reason).toBe("prompt_missing")
  })

  it("captureProvisionalPrompt reads the composer", () => {
    const html = `<div id="prompt-textarea">A red fox in the snow</div>`
    const doc = parseFixtureDocument(html) as unknown as Document
    const capture = captureProvisionalPrompt(doc)
    expect(capture?.originalPrompt).toBe(PROMPT)
    expect(capture?.provider).toBe("chatgpt")
  })

  it("captureProvisionalPrompt returns undefined for empty composer", () => {
    const doc = parseFixtureDocument(`<div id="prompt-textarea">  </div>`) as unknown as Document
    expect(captureProvisionalPrompt(doc)).toBeUndefined()
  })

  it("reconcileUserTurn normalizes whitespace and NBSP", () => {
    const doc = parseFixtureDocument(
      `<div data-testid="conversation-turn-1"><div data-message-author-role="user"><div class="whitespace-pre-wrap">A\u00a0red\u00a0fox\u00a0in\u00a0the\u00a0snow</div></div></div>`,
    ) as unknown as Document
    const reconciled = reconcileUserTurn(doc, PROMPT)
    expect(reconciled?.turn.turnId).toBe("chatgpt:conversation-turn-1")
  })

  it("forbidden private-API strings are absent from adapter source", () => {
    const adapter = readFileSync("src/providers/chatgpt/adapter.ts", "utf8")
    const selectors = readFileSync("src/providers/chatgpt/selectors.ts", "utf8")
    for (const forbidden of [
      "/backend-api/conversation",
      "revised_prompt",
      "accessToken",
      "Authorization",
    ]) {
      expect(adapter.includes(forbidden)).toBe(false)
      expect(selectors.includes(forbidden)).toBe(false)
    }
  })
})
