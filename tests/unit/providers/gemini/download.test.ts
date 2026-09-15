import { afterEach, describe, expect, it, vi } from "vitest"
import { readGeminiImageBytes } from "../../../../src/providers/gemini/download"
import { providerAdapters } from "../../../../src/providers/registry"
import type { ProviderImage } from "../../../../src/providers/types"
import { imageCandidateId, imageUrl, unixMilliseconds } from "../../../../src/shared/contracts"
import { installDomShim } from "../../content-ui/dom-shim"

function image(sourceUrl: string): ProviderImage {
  installDomShim()
  return {
    element: document.createElement("img"),
    proven: true,
    candidate: {
      id: imageCandidateId("gemini:test"),
      provider: "gemini",
      sourceUrl: imageUrl(sourceUrl),
      observedAt: unixMilliseconds(1_700_000_000_000),
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe("provider download isolation", () => {
  it("keeps ChatGPT and Grok on URL downloads without Gemini capture", () => {
    expect(providerAdapters.chatgpt.readImageBytes).toBeUndefined()
    expect(providerAdapters.grok.readImageBytes).toBeUndefined()
    expect(providerAdapters.gemini.readImageBytes).toBe(readGeminiImageBytes)
  })

  it("rejects a Gemini preview blob when full-size capture is unavailable", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    await expect(
      readGeminiImageBytes(image("blob:https://gemini.google.com/preview")),
    ).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("leaves a full-size Gemini href to the existing asset downloader", async () => {
    await expect(
      readGeminiImageBytes(image("https://gemini.google.com/full-size.png")),
    ).resolves.toBeUndefined()
  })
})
