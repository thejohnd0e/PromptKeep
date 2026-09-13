import fc from "fast-check"
import { expect, it } from "vitest"
import { LIMITS } from "../../src/shared/contracts"

it("keeps every safety limit a positive safe integer when selecting arbitrary limits", () => {
  const limitNames = [
    "maxInputBytes",
    "maxOutputBytes",
    "maxPromptUtf8Bytes",
    "maxXmpBytes",
    "maxPngChunks",
    "maxImageAxisPixels",
    "maxImagePixels",
    "operationExpiryMilliseconds",
  ] as const

  fc.assert(
    fc.property(fc.constantFrom(...limitNames), (limitName) => {
      const limit = LIMITS[limitName]

      expect(Number.isSafeInteger(limit)).toBe(true)
      expect(limit).toBeGreaterThan(0)
    }),
  )
})
