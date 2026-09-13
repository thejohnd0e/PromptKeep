import { describe, expect, it } from "vitest"
import { JobStore, type StoredJob } from "../../../src/chrome/job-store"
import { unixMilliseconds } from "../../../src/shared/contracts"
import { operationNonce } from "../../../src/shared/messages"

function createFakeStorage() {
  const map = new Map<string, unknown>()
  return {
    map,
    storage: {
      get: async (key: string) => map.get(key),
      getAll: async () => Object.fromEntries(map),
      set: async (key: string, value: unknown) => {
        map.set(key, value)
      },
      remove: async (key: string) => {
        map.delete(key)
      },
    },
  }
}

const NONCE = operationNonce("nonce-0000000000000001")

describe("job store", () => {
  it("opens a pending job and reads it back", async () => {
    const fake = createFakeStorage()
    const store = new JobStore({ storage: fake.storage, clock: () => unixMilliseconds(1_000) })
    const opened = await store.open(NONCE, unixMilliseconds(10_000))
    expect(opened).toEqual({
      kind: "ok",
      job: {
        nonce: NONCE,
        state: "pending",
        createdAt: unixMilliseconds(1_000),
        expiresAt: unixMilliseconds(10_000),
      },
    })
    const read = await store.get(NONCE)
    expect(read.kind).toBe("ok")
    if (read.kind === "ok") {
      expect(read.job.state).toBe("pending")
    }
  })

  it("rejects opening the same nonce twice", async () => {
    const fake = createFakeStorage()
    const store = new JobStore({ storage: fake.storage, clock: () => unixMilliseconds(1_000) })
    await store.open(NONCE, unixMilliseconds(10_000))
    const second = await store.open(NONCE, unixMilliseconds(10_000))
    expect(second).toEqual({ kind: "rejected", error: { code: "JOB_ALREADY_EXISTS" } })
  })

  it("rejects opening an already-expired job", async () => {
    const fake = createFakeStorage()
    const store = new JobStore({ storage: fake.storage, clock: () => unixMilliseconds(10_000) })
    const opened = await store.open(NONCE, unixMilliseconds(5_000))
    expect(opened).toEqual({
      kind: "rejected",
      error: { code: "JOB_EXPIRED", expiredAt: unixMilliseconds(5_000) },
    })
  })

  it("rejects reading a missing job", async () => {
    const fake = createFakeStorage()
    const store = new JobStore({ storage: fake.storage, clock: () => unixMilliseconds(1_000) })
    const read = await store.get(NONCE)
    expect(read).toEqual({ kind: "rejected", error: { code: "JOB_NOT_FOUND" } })
  })

  it("rejects reading an expired job", async () => {
    const fake = createFakeStorage()
    const store = new JobStore({ storage: fake.storage, clock: () => unixMilliseconds(1_000) })
    await store.open(NONCE, unixMilliseconds(5_000))
    const late = new JobStore({ storage: fake.storage, clock: () => unixMilliseconds(10_000) })
    const read = await late.get(NONCE)
    expect(read).toEqual({
      kind: "rejected",
      error: { code: "JOB_EXPIRED", expiredAt: unixMilliseconds(5_000) },
    })
  })

  it("marks a pending job as downloading", async () => {
    const fake = createFakeStorage()
    const store = new JobStore({ storage: fake.storage, clock: () => unixMilliseconds(1_000) })
    await store.open(NONCE, unixMilliseconds(10_000))
    const marked = await store.markDownloading(NONCE)
    expect(marked.kind).toBe("ok")
    if (marked.kind === "ok") {
      expect(marked.job.state).toBe("downloading")
    }
    const read = await store.get(NONCE)
    if (read.kind === "ok") {
      expect(read.job.state).toBe("downloading")
    }
  })

  it("rejects marking a missing job as downloading", async () => {
    const fake = createFakeStorage()
    const store = new JobStore({ storage: fake.storage, clock: () => unixMilliseconds(1_000) })
    const marked = await store.markDownloading(NONCE)
    expect(marked).toEqual({ kind: "rejected", error: { code: "JOB_NOT_FOUND" } })
  })

  it("deletes the job on complete", async () => {
    const fake = createFakeStorage()
    const store = new JobStore({ storage: fake.storage, clock: () => unixMilliseconds(1_000) })
    await store.open(NONCE, unixMilliseconds(10_000))
    await store.complete(NONCE)
    const read = await store.get(NONCE)
    expect(read).toEqual({ kind: "rejected", error: { code: "JOB_NOT_FOUND" } })
  })

  it("deletes the job on reject", async () => {
    const fake = createFakeStorage()
    const store = new JobStore({ storage: fake.storage, clock: () => unixMilliseconds(1_000) })
    await store.open(NONCE, unixMilliseconds(10_000))
    await store.reject(NONCE)
    const read = await store.get(NONCE)
    expect(read).toEqual({ kind: "rejected", error: { code: "JOB_NOT_FOUND" } })
  })

  it("restores a pending job after a simulated worker restart", async () => {
    const fake = createFakeStorage()
    const first = new JobStore({ storage: fake.storage, clock: () => unixMilliseconds(1_000) })
    await first.open(NONCE, unixMilliseconds(10_000))
    const restarted = new JobStore({ storage: fake.storage, clock: () => unixMilliseconds(2_000) })
    const read = await restarted.get(NONCE)
    expect(read.kind).toBe("ok")
    if (read.kind === "ok") {
      expect(read.job).toEqual({
        nonce: NONCE,
        state: "pending",
        createdAt: unixMilliseconds(1_000),
        expiresAt: unixMilliseconds(10_000),
      } satisfies StoredJob)
    }
  })

  it("cleanup removes only expired jobs and reports the count", async () => {
    const fake = createFakeStorage()
    const store = new JobStore({ storage: fake.storage, clock: () => unixMilliseconds(1_000) })
    const liveNonce = operationNonce("nonce-0000000000000002")
    await store.open(NONCE, unixMilliseconds(5_000))
    await store.open(liveNonce, unixMilliseconds(50_000))
    const late = new JobStore({ storage: fake.storage, clock: () => unixMilliseconds(10_000) })
    const removed = await late.cleanup(unixMilliseconds(10_000))
    expect(removed).toBe(1)
    expect(await late.get(NONCE)).toEqual({ kind: "rejected", error: { code: "JOB_NOT_FOUND" } })
    expect((await late.get(liveNonce)).kind).toBe("ok")
  })
})
