import { describe, expect, it } from "vitest"
import {
  type EnrichmentError,
  LIMITS,
  PROVIDERS,
  unixMilliseconds,
} from "../../src/shared/contracts"

function errorCode(error: EnrichmentError): string {
  switch (error.code) {
    case "unsupported_provider":
    case "prompt_missing":
    case "prompt_too_large":
    case "image_missing":
    case "association_ambiguous":
    case "confirmation_required":
    case "unsupported_media_type":
    case "download_failed":
    case "input_too_large":
    case "invalid_png":
    case "unsupported_png":
    case "xmp_too_large":
    case "output_too_large":
    case "operation_expired":
    case "operation_cancelled":
      return error.code
    default:
      return error satisfies never
  }
}

describe("public workspace contracts", () => {
  it("exposes exact providers when the workspace is bootstrapped", () => {
    expect(PROVIDERS).toEqual(["chatgpt", "gemini", "grok"])
  })

  it("exposes exact safety limits when the workspace is bootstrapped", () => {
    expect(LIMITS).toEqual({
      maxInputBytes: 104_857_600,
      maxOutputBytes: 104_857_600,
      maxPromptUtf8Bytes: 262_144,
      maxXmpBytes: 1_048_576,
      maxPngChunks: 10_000,
      maxImageAxisPixels: 32_768,
      maxImagePixels: 268_435_456,
      operationExpiryMilliseconds: 900_000,
    })
  })

  it("exposes exact exhaustive errors when downstream code dispatches them", () => {
    const errors = [
      { code: "unsupported_provider", provider: "other" },
      { code: "prompt_missing", provider: "chatgpt" },
      { code: "prompt_too_large", actualBytes: 262_145, limitBytes: 262_144 },
      { code: "image_missing", provider: "gemini" },
      { code: "association_ambiguous", candidateCount: 2 },
      { code: "confirmation_required", candidateCount: 1 },
      { code: "unsupported_media_type", mediaType: "image/jpeg" },
      { code: "download_failed", status: 503, reason: "NETWORK_FAILED" },
      { code: "input_too_large", actualBytes: 104_857_601, limitBytes: 104_857_600 },
      { code: "invalid_png", reason: "bad signature" },
      { code: "unsupported_png", feature: "APNG" },
      { code: "xmp_too_large", actualBytes: 1_048_577, limitBytes: 1_048_576 },
      { code: "output_too_large", actualBytes: 104_857_601, limitBytes: 104_857_600 },
      { code: "operation_expired", expiredAt: unixMilliseconds(900_000) },
      { code: "operation_cancelled" },
    ] as const satisfies readonly EnrichmentError[]

    expect(errors.map(errorCode)).toEqual([
      "unsupported_provider",
      "prompt_missing",
      "prompt_too_large",
      "image_missing",
      "association_ambiguous",
      "confirmation_required",
      "unsupported_media_type",
      "download_failed",
      "input_too_large",
      "invalid_png",
      "unsupported_png",
      "xmp_too_large",
      "output_too_large",
      "operation_expired",
      "operation_cancelled",
    ])
  })
})
