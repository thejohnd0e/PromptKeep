import { describe, expect, it } from "vitest"
import {
  imageCandidateId,
  imageUrl,
  LIMITS,
  promptCaptureId,
  unixMilliseconds,
} from "../../../src/shared/contracts"
import {
  ALLOWED_CONTENT_ORIGINS,
  type InitiateOperationMessage,
  MESSAGE_VERSION,
  type OffscreenJobMessage,
  operationNonce,
  parseInboundMessage,
  validateMessageSender,
} from "../../../src/shared/messages"
import { NonceRegistry } from "../../../src/shared/nonce-registry"

const NOW = unixMilliseconds(10_000)

function validInitiateMessage(): InitiateOperationMessage {
  return {
    version: MESSAGE_VERSION,
    type: "initiate_operation",
    nonce: operationNonce("nonce-0000000000000001"),
    createdAt: unixMilliseconds(5_000),
    promptCapture: {
      id: promptCaptureId("pc-1"),
      provider: "chatgpt",
      originalPrompt: "a cute corgi",
      capturedAt: unixMilliseconds(5_000),
    },
    imageCandidate: {
      id: imageCandidateId("ic-1"),
      provider: "chatgpt",
      sourceUrl: imageUrl("https://chatgpt.com/asset/1.png"),
      observedAt: unixMilliseconds(5_000),
    },
  }
}

function validOffscreenJob(): OffscreenJobMessage {
  return {
    version: MESSAGE_VERSION,
    type: "offscreen_job",
    nonce: operationNonce("nonce-0000000000000001"),
    providerSystemLabel: "ChatGPT",
    prompt: "a cute corgi",
  }
}

describe("message schema validation", () => {
  it("accepts a valid initiate message", () => {
    const result = parseInboundMessage(validInitiateMessage(), NOW)
    expect(result.kind).toBe("ok")
    if (result.kind === "ok" && result.message.type === "initiate_operation") {
      expect(result.message.nonce).toBe("nonce-0000000000000001")
    }
  })

  it("accepts an initiate message carrying an https source URL", () => {
    const message = validInitiateMessage()
    const withUrl = {
      ...message,
      promptCapture: {
        ...message.promptCapture,
        sourceUrl: "https://chatgpt.com/g/g-p-abc/c/def-123",
      },
    }

    const result = parseInboundMessage(withUrl, NOW)

    expect(result.kind).toBe("ok")
    if (result.kind === "ok" && result.message.type === "initiate_operation") {
      expect(result.message.promptCapture.sourceUrl).toBe("https://chatgpt.com/g/g-p-abc/c/def-123")
    }
  })

  it("rejects an initiate message with a non-https source URL", () => {
    const message = validInitiateMessage()
    const withUrl = {
      ...message,
      promptCapture: { ...message.promptCapture, sourceUrl: "http://evil.example/x" },
    }

    const result = parseInboundMessage(withUrl, NOW)

    expect(result.kind).toBe("rejected")
    if (result.kind === "rejected") {
      expect(result.error.code).toBe("MESSAGE_SCHEMA_MISMATCH")
    }
  })

  it("accepts an offscreen job carrying a source URL", () => {
    const job = {
      ...validOffscreenJob(),
      sourceUrl: "https://chatgpt.com/c/abc",
    }

    const result = parseInboundMessage(job, NOW)

    expect(result.kind).toBe("ok")
    if (result.kind === "ok" && result.message.type === "offscreen_job") {
      expect(result.message.sourceUrl).toBe("https://chatgpt.com/c/abc")
    }
  })

  it("rejects an offscreen job with a binary runtime payload", () => {
    const job = { ...validOffscreenJob(), sourceUrl: undefined, pngBytes: new ArrayBuffer(0) }
    const result = parseInboundMessage(job, NOW)
    expect(result.kind).toBe("rejected")
    if (result.kind === "rejected") {
      expect(result.error.code).toBe("MESSAGE_SCHEMA_MISMATCH")
    }
  })

  it("accepts a JSON-safe offscreen job with the asset URL", () => {
    // Given: the exact shape that survives Chrome runtime JSON serialization.
    const job = {
      version: MESSAGE_VERSION,
      type: "offscreen_job",
      nonce: operationNonce("nonce-0000000000000001"),
      providerSystemLabel: "ChatGPT",
      prompt: "a cute corgi",
    }

    // When: the offscreen boundary parses the transported message.
    const result = parseInboundMessage(job, NOW)

    // Then: the URL-based job is accepted without binary runtime payloads.
    expect(result.kind).toBe("ok")
    if (result.kind === "ok" && result.message.type === "offscreen_job") {
      expect("pngBytes" in result.message).toBe(false)
    }
  })

  it("accepts an offscreen Blob URL revocation message", () => {
    // Given: a JSON-safe cleanup message returned after download completion.
    const revoke = {
      version: MESSAGE_VERSION,
      type: "offscreen_revoke",
      nonce: operationNonce("nonce-0000000000000001"),
      blobUrl: "blob:chrome-extension://test/enriched-png",
    }

    // When: the offscreen boundary parses the cleanup message.
    const result = parseInboundMessage(revoke, NOW)

    // Then: cleanup reaches the offscreen listener instead of being rejected.
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.message.type).toBe("offscreen_revoke")
    }
  })

  it("rejects an unknown top-level key", () => {
    const message = { ...validInitiateMessage(), extra: "sneaky" }
    const result = parseInboundMessage(message, NOW)
    expect(result.kind).toBe("rejected")
    if (result.kind === "rejected") {
      expect(result.error.code).toBe("MESSAGE_SCHEMA_MISMATCH")
    }
  })

  it("rejects an unknown message type", () => {
    const message = { ...validInitiateMessage(), type: "exploit" }
    const result = parseInboundMessage(message, NOW)
    expect(result.kind).toBe("rejected")
    if (result.kind === "rejected") {
      expect(result.error.code).toBe("MESSAGE_UNKNOWN_TYPE")
    }
  })

  it("rejects a non-object message", () => {
    const result = parseInboundMessage("not-a-message", NOW)
    expect(result.kind).toBe("rejected")
    if (result.kind === "rejected") {
      expect(result.error.code).toBe("MESSAGE_NOT_OBJECT")
    }
  })

  it("rejects an expired nonce", () => {
    const message = validInitiateMessage()
    const expiredAt = unixMilliseconds(message.createdAt + LIMITS.operationExpiryMilliseconds)
    const result = parseInboundMessage(message, expiredAt)
    expect(result.kind).toBe("rejected")
    if (result.kind === "rejected") {
      expect(result.error.code).toBe("MESSAGE_NONCE_EXPIRED")
    }
  })

  it("rejects a malformed prompt that exceeds the byte limit", () => {
    const message = validInitiateMessage()
    const oversized = {
      ...message,
      promptCapture: {
        ...message.promptCapture,
        originalPrompt: "x".repeat(LIMITS.maxPromptUtf8Bytes + 1),
      },
    }
    const result = parseInboundMessage(oversized, NOW)
    expect(result.kind).toBe("rejected")
    if (result.kind === "rejected") {
      expect(result.error.code).toBe("MESSAGE_SCHEMA_MISMATCH")
    }
  })

  it("rejects a malformed url that is not https", () => {
    const message = validInitiateMessage()
    const badUrl = {
      ...message,
      imageCandidate: {
        ...message.imageCandidate,
        sourceUrl: imageUrl("http://localhost:8080/secret.png"),
      },
    }
    const result = parseInboundMessage(badUrl, NOW)
    expect(result.kind).toBe("rejected")
    if (result.kind === "rejected") {
      expect(result.error.code).toBe("MESSAGE_SCHEMA_MISMATCH")
    }
  })

  it("rejects a malformed url that is not a URL at all", () => {
    const message = validInitiateMessage()
    const badUrl = {
      ...message,
      imageCandidate: {
        ...message.imageCandidate,
        sourceUrl: imageUrl("not-a-url"),
      },
    }
    const result = parseInboundMessage(badUrl, NOW)
    expect(result.kind).toBe("rejected")
    if (result.kind === "rejected") {
      expect(result.error.code).toBe("MESSAGE_SCHEMA_MISMATCH")
    }
  })
})

describe("sender validation", () => {
  it("accepts an allowlisted content-script sender", () => {
    const result = validateMessageSender(
      { id: "our-extension-id", url: "https://chatgpt.com/thread/1" },
      "our-extension-id",
    )
    expect(result).toEqual({ kind: "ok", origin: "content" })
  })

  it("accepts the offscreen document sender", () => {
    const result = validateMessageSender(
      { id: "our-extension-id", url: "chrome-extension://our-extension-id/offscreen.html" },
      "our-extension-id",
    )
    expect(result).toEqual({ kind: "ok", origin: "offscreen" })
  })

  it("rejects a wrong runtime id in the sender", () => {
    const result = validateMessageSender(
      { id: "attacker-extension-id", url: "https://chatgpt.com/thread/1" },
      "our-extension-id",
    )
    expect(result).toEqual({ kind: "rejected", error: { code: "SENDER_RUNTIME_ID_MISMATCH" } })
  })

  it("rejects a sender origin outside the allowlist", () => {
    const result = validateMessageSender(
      { id: "our-extension-id", url: "https://evil.example.com/phish" },
      "our-extension-id",
    )
    expect(result).toEqual({ kind: "rejected", error: { code: "SENDER_ORIGIN_NOT_ALLOWED" } })
  })

  it("rejects a sender with no url", () => {
    const result = validateMessageSender({ id: "our-extension-id" }, "our-extension-id")
    expect(result).toEqual({ kind: "rejected", error: { code: "SENDER_URL_MISSING" } })
  })

  it("exposes exactly the three provider origins", () => {
    expect(ALLOWED_CONTENT_ORIGINS).toEqual([
      "https://chatgpt.com",
      "https://gemini.google.com",
      "https://grok.com",
    ])
  })
})

describe("replayed nonce state layer", () => {
  it("rejects the same nonce registered twice", () => {
    // The in-memory registry is a replay guard only; production persistence of
    // operation state across service-worker suspension is task 8.
    const registry = new NonceRegistry(() => NOW)
    const nonce = operationNonce("nonce-0000000000000001")
    const expiresAt = unixMilliseconds(NOW + LIMITS.operationExpiryMilliseconds)
    expect(registry.register(nonce, expiresAt)).toEqual({ kind: "ok" })
    expect(registry.register(nonce, expiresAt)).toEqual({
      kind: "rejected",
      error: { code: "NONCE_REPLAYED" },
    })
  })
})
