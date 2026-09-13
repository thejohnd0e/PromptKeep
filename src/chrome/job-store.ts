import type { OperationNonce, UnixMilliseconds } from "../shared/contracts"

export type JobState = "pending" | "downloading"

export type StoredJob = {
  readonly nonce: OperationNonce
  readonly state: JobState
  readonly createdAt: UnixMilliseconds
  readonly expiresAt: UnixMilliseconds
}

export type JobStoreError =
  | { readonly code: "JOB_NOT_FOUND" }
  | { readonly code: "JOB_EXPIRED"; readonly expiredAt: UnixMilliseconds }
  | { readonly code: "JOB_ALREADY_EXISTS" }

export type JobStoreResult =
  | { readonly kind: "ok"; readonly job: StoredJob }
  | { readonly kind: "rejected"; readonly error: JobStoreError }

export type JobStoreDeps = {
  readonly storage: {
    readonly get: (key: string) => Promise<unknown>
    readonly getAll: () => Promise<Readonly<Record<string, unknown>>>
    readonly set: (key: string, value: unknown) => Promise<void>
    readonly remove: (key: string) => Promise<void>
  }
  readonly clock: () => UnixMilliseconds
}

const JOB_KEY_PREFIX = "job:"

function jobKey(nonce: OperationNonce): string {
  return `${JOB_KEY_PREFIX}${nonce}`
}

/**
 * Expiring operation state persisted in chrome.storage.session so a pending
 * download survives MV3 service-worker suspension. Terminal and expired jobs
 * are deleted immediately; the raw prompt never enters storage.
 */
export class JobStore {
  readonly #storage: JobStoreDeps["storage"]
  readonly #clock: () => UnixMilliseconds

  constructor(deps: JobStoreDeps) {
    this.#storage = deps.storage
    this.#clock = deps.clock
  }

  async open(nonce: OperationNonce, expiresAt: UnixMilliseconds): Promise<JobStoreResult> {
    const now = this.#clock()
    if (expiresAt <= now) {
      return { kind: "rejected", error: { code: "JOB_EXPIRED", expiredAt: expiresAt } }
    }
    const existing = await this.#storage.get(jobKey(nonce))
    if (existing !== undefined) {
      return { kind: "rejected", error: { code: "JOB_ALREADY_EXISTS" } }
    }
    const job: StoredJob = { nonce, state: "pending", createdAt: now, expiresAt }
    await this.#storage.set(jobKey(nonce), job)
    return { kind: "ok", job }
  }

  async get(nonce: OperationNonce): Promise<JobStoreResult> {
    const stored = await this.#storage.get(jobKey(nonce))
    if (stored === undefined) return { kind: "rejected", error: { code: "JOB_NOT_FOUND" } }
    const job = stored as StoredJob
    if (job.expiresAt <= this.#clock()) {
      return { kind: "rejected", error: { code: "JOB_EXPIRED", expiredAt: job.expiresAt } }
    }
    return { kind: "ok", job }
  }

  async markDownloading(nonce: OperationNonce): Promise<JobStoreResult> {
    const current = await this.get(nonce)
    if (current.kind === "rejected") return current
    const job: StoredJob = { ...current.job, state: "downloading" }
    await this.#storage.set(jobKey(nonce), job)
    return { kind: "ok", job }
  }

  async complete(nonce: OperationNonce): Promise<void> {
    await this.#storage.remove(jobKey(nonce))
  }

  async reject(nonce: OperationNonce): Promise<void> {
    await this.#storage.remove(jobKey(nonce))
  }

  async cleanup(now: UnixMilliseconds): Promise<number> {
    const entries = await this.#storage.getAll()
    let removed = 0
    for (const [storedKey, value] of Object.entries(entries)) {
      if (!storedKey.startsWith(JOB_KEY_PREFIX)) continue
      const job = value as StoredJob
      if (job.expiresAt <= now) {
        await this.#storage.remove(storedKey)
        removed += 1
      }
    }
    return removed
  }
}
