import type { OperationNonce, UnixMilliseconds } from "./contracts"

export type NonceRejection =
  | { readonly code: "NONCE_UNKNOWN" }
  | { readonly code: "NONCE_EXPIRED"; readonly expiredAt: UnixMilliseconds }
  | { readonly code: "NONCE_REPLAYED" }

export type NonceRegistryResult =
  | { readonly kind: "ok" }
  | { readonly kind: "rejected"; readonly error: NonceRejection }

type NonceEntry = { readonly expiresAt: UnixMilliseconds; consumed: boolean }

/**
 * In-memory replay guard for operation nonces. This is a best-effort guard
 * only: production persistence of operation state across service-worker
 * suspension is task 8.
 */
export class NonceRegistry {
  readonly #entries = new Map<string, NonceEntry>()
  readonly #clock: () => UnixMilliseconds

  constructor(clock: () => UnixMilliseconds) {
    this.#clock = clock
  }

  register(nonce: OperationNonce, expiresAt: UnixMilliseconds): NonceRegistryResult {
    const now = this.#clock()
    if (expiresAt <= now) {
      return { kind: "rejected", error: { code: "NONCE_EXPIRED", expiredAt: expiresAt } }
    }
    const existing = this.#entries.get(nonce)
    if (existing !== undefined) {
      if (existing.expiresAt <= now) {
        return { kind: "rejected", error: { code: "NONCE_EXPIRED", expiredAt: existing.expiresAt } }
      }
      return { kind: "rejected", error: { code: "NONCE_REPLAYED" } }
    }
    this.#entries.set(nonce, { expiresAt, consumed: false })
    return { kind: "ok" }
  }

  verify(nonce: OperationNonce): NonceRegistryResult {
    const now = this.#clock()
    const entry = this.#entries.get(nonce)
    if (entry === undefined) return { kind: "rejected", error: { code: "NONCE_UNKNOWN" } }
    if (entry.expiresAt <= now) {
      return { kind: "rejected", error: { code: "NONCE_EXPIRED", expiredAt: entry.expiresAt } }
    }
    if (entry.consumed) return { kind: "rejected", error: { code: "NONCE_REPLAYED" } }
    return { kind: "ok" }
  }

  consume(nonce: OperationNonce): NonceRegistryResult {
    const verified = this.verify(nonce)
    if (verified.kind === "rejected") return verified
    const entry = this.#entries.get(nonce)
    if (entry === undefined) return { kind: "rejected", error: { code: "NONCE_UNKNOWN" } }
    entry.consumed = true
    return { kind: "ok" }
  }

  prune(): void {
    const now = this.#clock()
    for (const [nonce, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(nonce)
    }
  }
}
