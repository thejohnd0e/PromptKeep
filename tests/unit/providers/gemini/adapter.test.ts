import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  captureGeminiTurn,
  captureProvisionalPrompt,
} from "../../../../src/providers/gemini/adapter"
import { GEMINI_SELECTORS_VERSION } from "../../../../src/providers/gemini/selectors"
import { promptCaptureId, unixMilliseconds } from "../../../../src/shared/contracts"
import { parseFixtureDocument } from "../html-fixture"

const NOW = unixMilliseconds(1_700_000_000_000)
const CAPTURE_ID = promptCaptureId("gemini:test-capture")
const PROMPT = "A watercolor lighthouse"

function fixture(name: string) {
  const html = readFileSync(`tests/fixtures/providers/gemini/${name}.html`, "utf8")
  return parseFixtureDocument(html) as unknown as Document
}

describe("gemini adapter", () => {
  it("pins the selectors version", () => {
    expect(GEMINI_SELECTORS_VERSION).toBe(1)
  })

  it("full-size: reconciles prompt and classifies one proven image", () => {
    const result = captureGeminiTurn(fixture("full-size"), PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.promptCapture.originalPrompt).toBe(PROMPT)
    expect(result.promptCapture.providerTurnId).toBe("gemini:2")
    expect(result.association).toBe("provider_identity")
    expect(result.images.length).toBe(1)
  })

  it("historical: matches the prompt in an earlier visible turn", () => {
    const result = captureGeminiTurn(fixture("historical"), PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.promptCapture.providerTurnId).toBe("gemini:4")
  })

  it("multi-image: classifies both outputs", () => {
    const result = captureGeminiTurn(fixture("multi-image"), "Two lighthouses", NOW, CAPTURE_ID)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.images.length).toBe(2)
    expect(result.association).toBe("provider_identity")
  })

  it("lazy-load: image without src requires confirmation", () => {
    const result = captureGeminiTurn(fixture("lazy-load"), PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.association).toBe("confirmation_required")
  })

  it("missing-prompt: no matching user turn rejects", () => {
    const result = captureGeminiTurn(fixture("missing-prompt"), PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("rejected")
  })

  it("thumbnail-only: no download control yields confirmation_required", () => {
    const result = captureGeminiTurn(fixture("thumbnail-only"), PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.association).toBe("confirmation_required")
  })

  it("non-png: webp asset classified by URL (signature enforced at download)", () => {
    const result = captureGeminiTurn(fixture("non-png"), PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.images[0]?.candidate.sourceUrl).toContain(".webp")
  })

  it("unsupported-library: Images/Library unsupported state rejects", () => {
    const result = captureGeminiTurn(fixture("unsupported-library"), PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.reason).toBe("unsupported_library_state")
  })

  it("changed-dom: unknown future markup yields no images (fail-closed)", () => {
    const result = captureGeminiTurn(fixture("changed-dom"), PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.reason).toBe("no_images")
  })

  it("empty prompt is rejected", () => {
    const result = captureGeminiTurn(fixture("full-size"), "  ", NOW, CAPTURE_ID)
    expect(result.kind).toBe("rejected")
  })

  it("captureProvisionalPrompt reads the composer", () => {
    const doc = parseFixtureDocument(
      `<rich-textarea><div class="ql-editor" contenteditable="true">${PROMPT}</div></rich-textarea>`,
    ) as unknown as Document
    const capture = captureProvisionalPrompt(doc)
    expect(capture?.originalPrompt).toBe(PROMPT)
    expect(capture?.provider).toBe("gemini")
  })

  it("forbidden private-RPC strings are absent from adapter source", () => {
    const adapter = readFileSync("src/providers/gemini/adapter.ts", "utf8")
    const selectors = readFileSync("src/providers/gemini/selectors.ts", "utf8")
    for (const forbidden of [
      "batchexecute",
      "fetch(",
      "XMLHttpRequest",
      "lh3.googleusercontent.com/=",
      "Authorization",
    ]) {
      expect(adapter.includes(forbidden)).toBe(false)
      expect(selectors.includes(forbidden)).toBe(false)
    }
  })
})
