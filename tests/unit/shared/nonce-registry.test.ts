import { describe, expect, it } from "vitest"
import { LIMITS, unixMilliseconds } from "../../../src/shared/contracts"
import { operationNonce } from "../../../src/shared/messages"
import { NonceRegistry } from "../../../src/shared/nonce-registry"

const NOW = unixMilliseconds(10_000)

describe("NonceRegistry", () => {
  it("registers a fresh nonce", () => {
    const registry = new NonceRegistry(() => NOW)
    const result = registry.register(
      operationNonce("nonce-0000000000000001"),
      unixMilliseconds(NOW + LIMITS.operationExpiryMilliseconds),
    )
    expect(result).toEqual({ kind: "ok" })
  })

  it("rejects a replayed nonce on the second registration", () => {
    const registry = new NonceRegistry(() => NOW)
    const nonce = operationNonce("nonce-0000000000000001")
    const expiresAt = unixMilliseconds(NOW + LIMITS.operationExpiryMilliseconds)
    expect(registry.register(nonce, expiresAt)).toEqual({ kind: "ok" })
    expect(registry.register(nonce, expiresAt)).toEqual({
      kind: "rejected",
      error: { code: "NONCE_REPLAYED" },
    })
  })

  it("rejects an already-expired nonce at registration", () => {
    const registry = new NonceRegistry(() => NOW)
    const result = registry.register(operationNonce("nonce-0000000000000001"), NOW)
    expect(result).toEqual({
      kind: "rejected",
      error: { code: "NONCE_EXPIRED", expiredAt: NOW },
    })
  })

  it("verifies a registered nonce", () => {
    const registry = new NonceRegistry(() => NOW)
    const nonce = operationNonce("nonce-0000000000000001")
    registry.register(nonce, unixMilliseconds(NOW + LIMITS.operationExpiryMilliseconds))
    expect(registry.verify(nonce)).toEqual({ kind: "ok" })
  })

  it("rejects an unknown nonce", () => {
    const registry = new NonceRegistry(() => NOW)
    expect(registry.verify(operationNonce("nonce-0000000000000001"))).toEqual({
      kind: "rejected",
      error: { code: "NONCE_UNKNOWN" },
    })
  })

  it("rejects a nonce after its expiry time", () => {
    let now = NOW
    const registry = new NonceRegistry(() => now)
    const nonce = operationNonce("nonce-0000000000000001")
    const expiresAt = unixMilliseconds(NOW + LIMITS.operationExpiryMilliseconds)
    registry.register(nonce, expiresAt)
    now = expiresAt
    expect(registry.verify(nonce)).toEqual({
      kind: "rejected",
      error: { code: "NONCE_EXPIRED", expiredAt: expiresAt },
    })
  })

  it("consumes a nonce exactly once", () => {
    const registry = new NonceRegistry(() => NOW)
    const nonce = operationNonce("nonce-0000000000000001")
    registry.register(nonce, unixMilliseconds(NOW + LIMITS.operationExpiryMilliseconds))
    expect(registry.consume(nonce)).toEqual({ kind: "ok" })
    expect(registry.consume(nonce)).toEqual({
      kind: "rejected",
      error: { code: "NONCE_REPLAYED" },
    })
  })

  it("prunes expired entries", () => {
    let now = NOW
    const registry = new NonceRegistry(() => now)
    const expiredAt = unixMilliseconds(NOW + LIMITS.operationExpiryMilliseconds)
    registry.register(operationNonce("nonce-0000000000000001"), expiredAt)
    now = unixMilliseconds(expiredAt + 1)
    registry.prune()
    expect(registry.verify(operationNonce("nonce-0000000000000001"))).toEqual({
      kind: "rejected",
      error: { code: "NONCE_UNKNOWN" },
    })
  })
})
