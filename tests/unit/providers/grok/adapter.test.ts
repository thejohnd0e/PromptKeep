import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { captureGrokTurn, captureProvisionalPrompt } from "../../../../src/providers/grok/adapter"
import { GROK_SELECTORS_VERSION } from "../../../../src/providers/grok/selectors"
import { promptCaptureId, unixMilliseconds } from "../../../../src/shared/contracts"
import { parseFixtureDocument } from "../html-fixture"

const NOW = unixMilliseconds(1_700_000_000_000)
const CAPTURE_ID = promptCaptureId("grok:test-capture")
const PROMPT = "A neon cyberpunk city"

function fixture(name: string) {
  const html = readFileSync(`tests/fixtures/providers/grok/${name}.html`, "utf8")
  return parseFixtureDocument(html) as unknown as Document
}

describe("grok adapter", () => {
  it("pins the selectors version", () => {
    expect(GROK_SELECTORS_VERSION).toBe(1)
  })

  it("current: reconciles prompt and classifies one proven image", () => {
    const result = captureGrokTurn(fixture("current"), PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.promptCapture.originalPrompt).toBe(PROMPT)
    expect(result.promptCapture.providerTurnId).toBe("grok:m2")
    expect(result.association).toBe("provider_identity")
    expect(result.images.length).toBe(1)
  })

  it("multi-image: classifies both cards", () => {
    const result = captureGrokTurn(fixture("multi-image"), "Two cities", NOW, CAPTURE_ID)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.images.length).toBe(2)
    expect(result.association).toBe("provider_identity")
  })

  it("stale-previous: binds to the latest matching message, not the stale card", () => {
    const result = captureGrokTurn(fixture("stale-previous"), PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.promptCapture.providerTurnId).toBe("grok:m4")
    expect(result.images[0]?.candidate.sourceUrl).toContain("city-v2")
  })

  it("expired-url: expired card rejects with asset_expired", () => {
    const result = captureGrokTurn(fixture("expired-url"), PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.reason).toBe("asset_expired")
  })

  it("auth-failure: sign-in card rejects with asset_auth_failed", () => {
    const result = captureGrokTurn(fixture("auth-failure"), PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.reason).toBe("asset_auth_failed")
  })

  it("blob-only: blob URL is not a proven asset (confirmation required)", () => {
    const result = captureGrokTurn(fixture("blob-only"), PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.association).toBe("confirmation_required")
  })

  it("non-png: jpeg asset classified by URL (signature enforced at download)", () => {
    const result = captureGrokTurn(fixture("non-png"), PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.images[0]?.candidate.sourceUrl).toContain(".jpg")
  })

  it("changed-dom: unknown future markup yields no images (fail-closed)", () => {
    const result = captureGrokTurn(fixture("changed-dom"), PROMPT, NOW, CAPTURE_ID)
    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.reason).toBe("no_images")
  })

  it("empty prompt is rejected", () => {
    const result = captureGrokTurn(fixture("current"), "  ", NOW, CAPTURE_ID)
    expect(result.kind).toBe("rejected")
  })

  it("captureProvisionalPrompt reads the composer", () => {
    const doc = parseFixtureDocument(
      `<textarea placeholder="Ask Grok anything">${PROMPT}</textarea>`,
    ) as unknown as Document
    const capture = captureProvisionalPrompt(doc)
    expect(capture?.originalPrompt).toBe(PROMPT)
    expect(capture?.provider).toBe("grok")
  })

  it("forbidden private-API strings are absent from adapter source", () => {
    const adapter = readFileSync("src/providers/grok/adapter.ts", "utf8")
    const selectors = readFileSync("src/providers/grok/selectors.ts", "utf8")
    for (const forbidden of ["ig_", "saved", "favorites", "api.x.ai", "Authorization"]) {
      expect(adapter.includes(forbidden)).toBe(false)
      expect(selectors.includes(forbidden)).toBe(false)
    }
  })
})
