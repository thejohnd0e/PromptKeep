import { describe, expect, it } from "vitest"
import { type AssociationAttempt, createAssociationAttempt } from "../../../src/shared/association"
import { associationAttemptId, imageUrl, unixMilliseconds } from "../../../src/shared/contracts"
import {
  JOB_STORAGE_KEY,
  SessionJobStore,
  type SessionStorageArea,
  type SessionStorageSnapshot,
  type SessionStorageWrite,
} from "../../../src/shared/job-state"
import { attempt, awaiting, ready } from "./association-fixtures"

class MemorySessionStorage implements SessionStorageArea {
  snapshot: SessionStorageSnapshot = {}

  async get(_key: typeof JOB_STORAGE_KEY): Promise<SessionStorageSnapshot> {
    return structuredClone(this.snapshot)
  }

  async set(items: SessionStorageWrite): Promise<void> {
    this.snapshot = structuredClone(items)
  }

  async remove(_key: typeof JOB_STORAGE_KEY): Promise<void> {
    this.snapshot = {}
  }
}

async function openPending(store: SessionJobStore, active: AssociationAttempt): Promise<void> {
  const result = await store.open(awaiting(active))
  expect(result.kind).toBe("ok")
}

function staleReady(active: AssociationAttempt) {
  return ready(
    createAssociationAttempt({
      ...active,
      id: associationAttemptId("attempt-stale"),
    }),
  )
}

describe("association storage reviewer regressions", () => {
  it("rejects saveReady for a stale attempt sharing the active job", async () => {
    const storage = new MemorySessionStorage()
    const store = new SessionJobStore(storage, () => unixMilliseconds(1_200))
    const active = attempt()
    await openPending(store, active)
    const pendingSnapshot = structuredClone(storage.snapshot)

    const result = await store.saveReady(staleReady(active))

    expect(result).toEqual({ kind: "rejected", error: { code: "JOB_NOT_FOUND" } })
    expect(storage.snapshot).toEqual(pendingSnapshot)
  })

  it("rejects start for a stale attempt sharing the active job", async () => {
    const storage = new MemorySessionStorage()
    const store = new SessionJobStore(storage, () => unixMilliseconds(1_200))
    const active = attempt()
    await openPending(store, active)
    const pendingSnapshot = structuredClone(storage.snapshot)

    const result = await store.start(staleReady(active), unixMilliseconds(1_250))

    expect(result).toEqual({ kind: "rejected", error: { code: "JOB_NOT_FOUND" } })
    expect(storage.snapshot).toEqual(pendingSnapshot)
  })

  it.each(["data:image/png;base64,iVBORw0KGgo=", "inline-image:image/png;base64,iVBORw0KGgo="])(
    "rejects persisted image URL scheme for %s",
    async (sourceUrl) => {
      const storage = new MemorySessionStorage()
      const store = new SessionJobStore(storage, () => unixMilliseconds(1_200))
      const active = attempt()
      await openPending(store, active)
      const safeReady = ready(active)
      const inlinePayloadReady = {
        ...safeReady,
        binding: {
          ...safeReady.binding,
          imageCandidate: {
            ...safeReady.binding.imageCandidate,
            sourceUrl: imageUrl(sourceUrl),
          },
        },
      }

      const result = await store.saveReady(inlinePayloadReady)

      expect(result).toEqual({ kind: "rejected", error: { code: "STORAGE_MALFORMED" } })
      expect(storage.snapshot[JOB_STORAGE_KEY]).not.toContain("iVBORw0KGgo")
    },
  )
})
