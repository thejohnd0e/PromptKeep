import { describe, expect, it } from "vitest"
import { type PngTaskRequest, runPngTask } from "../../../src/offscreen/png-task"
import { MESSAGE_VERSION, operationNonce } from "../../../src/shared/messages"
import { buildValidPng, makeChunk } from "../../fixtures/png/png-fixtures"

const NONCE = operationNonce("nonce-0000000000000001")

function request(overrides: Partial<PngTaskRequest> = {}): PngTaskRequest {
  return {
    nonce: NONCE,
    providerSystemLabel: "ChatGPT",
    prompt: "a cute corgi",
    pngBytes: buildValidPng().slice().buffer,
    filenameBase: "nonce-0000000000000001",
    acknowledgeCaBX: false,
    ...overrides,
  }
}

describe("png task", () => {
  it("enriches a valid PNG and downloads the enriched bytes", async () => {
    const input = buildValidPng()
    const downloaded: Uint8Array[] = []
    const result = await runPngTask(request({ pngBytes: input.slice().buffer }), {
      downloadBytes: async (bytes, filenameBase) => {
        downloaded.push(bytes)
        expect(filenameBase).toBe("nonce-0000000000000001")
        return { kind: "ok", downloadId: 1 }
      },
    })
    expect(result).toEqual({
      kind: "ok",
      message: { version: MESSAGE_VERSION, type: "offscreen_ack", nonce: NONCE },
    })
    expect(downloaded).toHaveLength(1)
    const enriched = downloaded[0]
    expect(enriched).toBeDefined()
    if (enriched !== undefined) {
      expect(enriched).not.toEqual(input)
      expect(enriched.byteLength).toBeGreaterThan(input.byteLength)
    }
  })

  it("rejects an unknown provider system label", async () => {
    const result = await runPngTask(request({ providerSystemLabel: "Claude" }), {
      downloadBytes: async () => ({ kind: "ok", downloadId: 1 }),
    })
    expect(result).toEqual({
      kind: "rejected",
      message: {
        version: MESSAGE_VERSION,
        type: "operation_rejected",
        nonce: NONCE,
        error: { code: "unsupported_provider", provider: "Claude" },
      },
    })
  })

  it("rejects a caBX source without acknowledgement as operation_cancelled", async () => {
    const cabx = buildValidPng({
      ancillary: [makeChunk("caBX", new TextEncoder().encode("c2pa"))],
    })
    const result = await runPngTask(request({ pngBytes: cabx.slice().buffer }), {
      downloadBytes: async () => ({ kind: "ok", downloadId: 1 }),
    })
    expect(result.kind).toBe("rejected")
    if (result.kind === "rejected") {
      expect(result.message.error).toEqual({ code: "operation_cancelled" })
    }
  })

  it("rejects non-PNG bytes as unsupported_media_type", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    const result = await runPngTask(request({ pngBytes: jpeg.buffer }), {
      downloadBytes: async () => ({ kind: "ok", downloadId: 1 }),
    })
    expect(result.kind).toBe("rejected")
    if (result.kind === "rejected") {
      expect(result.message.error).toEqual({
        code: "unsupported_media_type",
        mediaType: "image/jpeg",
      })
    }
  })

  it("rejects an empty prompt as prompt_missing", async () => {
    const result = await runPngTask(request({ prompt: "   " }), {
      downloadBytes: async () => ({ kind: "ok", downloadId: 1 }),
    })
    expect(result.kind).toBe("rejected")
    if (result.kind === "rejected") {
      expect(result.message.error).toEqual({ code: "prompt_missing", provider: "chatgpt" })
    }
  })

  it("accepts a Blob payload", async () => {
    const input = buildValidPng()
    const blob = new Blob([input.slice()], { type: "image/png" })
    const result = await runPngTask(request({ pngBytes: blob }), {
      downloadBytes: async () => ({ kind: "ok", downloadId: 1 }),
    })
    expect(result.kind).toBe("ok")
  })

  it("maps a download failure to download_failed", async () => {
    const result = await runPngTask(request(), {
      downloadBytes: async () => ({ kind: "rejected", error: { code: "DOWNLOAD_FAILED" } }),
    })
    expect(result.kind).toBe("rejected")
    if (result.kind === "rejected") {
      expect(result.message.error).toEqual({ code: "download_failed" })
    }
  })

  it("maps a cancelled download to operation_cancelled", async () => {
    const result = await runPngTask(request(), {
      downloadBytes: async () => ({ kind: "rejected", error: { code: "DOWNLOAD_CANCELLED" } }),
    })
    expect(result.kind).toBe("rejected")
    if (result.kind === "rejected") {
      expect(result.message.error).toEqual({ code: "operation_cancelled" })
    }
  })
})
