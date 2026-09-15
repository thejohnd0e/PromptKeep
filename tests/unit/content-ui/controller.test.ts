import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { startController } from "../../../src/content/controller"
import type { ScanResult } from "../../../src/providers/types"
import {
  imageCandidateId,
  imageUrl,
  providerTurnId,
  unixMilliseconds,
} from "../../../src/shared/contracts"
import type { ContentResponse, InitiateOperationMessage } from "../../../src/shared/messages"
import { installDomShim, type MockDocument, type MockElement } from "./dom-shim"

let doc: MockDocument

function fire(element: Element | null | undefined, type: string): void {
  ;(element as MockElement | null | undefined)?.dispatchEvent({
    type,
    preventDefault: () => {},
    stopPropagation: () => {},
  })
}

function accepted(message: InitiateOperationMessage): ContentResponse {
  return { version: message.version, type: "operation_accepted", nonce: message.nonce }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe("startController", () => {
  beforeEach(() => {
    doc = installDomShim()
    vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000001" })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("uses image bytes supplied by the provider adapter", async () => {
    const image = document.createElement("img")
    const container = document.createElement("figure")
    const fullSizeButton = document.createElement("button")
    const sent: InitiateOperationMessage[] = []
    const mockContainer = container as unknown as MockElement
    mockContainer.appendChild(image as unknown as MockElement)
    doc.body.appendChild(mockContainer)
    const scanResult: ScanResult = {
      prompt: "A watercolor lighthouse",
      turnId: "gemini:2",
      association: "confirmation_required",
      images: [
        {
          candidate: {
            id: imageCandidateId("gemini:test:0"),
            provider: "gemini",
            sourceUrl: imageUrl("blob:https://gemini.google.com/preview"),
            observedAt: unixMilliseconds(1_700_000_000_000),
            providerTurnId: providerTurnId("gemini:2"),
          },
          proven: false,
          element: image,
          fullSizeElement: fullSizeButton,
        },
      ],
    }

    startController({
      document_like: doc as unknown as Document,
      provider: "gemini",
      scan: () => [scanResult],
      sendInitiate: async (message) => {
        sent.push(message)
        return accepted(message)
      },
      readImageBytes: async (source) =>
        source.fullSizeElement === fullSizeButton
          ? [137, 80, 78, 71, 13, 10, 26, 10, 1]
          : undefined,
      now: () => unixMilliseconds(1_700_000_000_000),
      pageUrl: () => "https://gemini.google.com/app/test",
      extensionVersion: "1.16",
    })

    fire(doc.body.querySelector(".aip2e-download-button") as unknown as Element | null, "click")
    await flushPromises()

    expect(sent).toHaveLength(1)
    expect(sent[0]?.imageBytes).toEqual([137, 80, 78, 71, 13, 10, 26, 10, 1])
  })
})
