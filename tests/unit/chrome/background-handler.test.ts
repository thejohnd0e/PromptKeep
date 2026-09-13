import { describe, expect, it } from "vitest"
import { type BackgroundDeps, handleInitiateOperation } from "../../../src/chrome/background"
import { JobStore } from "../../../src/chrome/job-store"
import {
  imageCandidateId,
  imageUrl,
  LIMITS,
  promptCaptureId,
  unixMilliseconds,
} from "../../../src/shared/contracts"
import {
  type InitiateOperationMessage,
  MESSAGE_VERSION,
  type OffscreenJobMessage,
  operationNonce,
} from "../../../src/shared/messages"
import { NonceRegistry } from "../../../src/shared/nonce-registry"
import { buildValidPng } from "../../fixtures/png/png-fixtures"

const NOW = unixMilliseconds(10_000)
const NONCE = operationNonce("nonce-0000000000000001")

function validInitiateMessage(): InitiateOperationMessage {
  return {
    version: MESSAGE_VERSION,
    type: "initiate_operation",
    nonce: NONCE,
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

function createDeps(overrides: Partial<BackgroundDeps> = {}) {
  const nonceRegistry = new NonceRegistry(() => NOW)
  const fake = createFakeStorage()
  const jobStore = new JobStore({ storage: fake.storage, clock: () => NOW })
  const calls = {
    fetched: [] as string[],
    sent: [] as unknown[],
    ensureOffscreen: 0,
  }
  const deps: BackgroundDeps = {
    nonceRegistry,
    jobStore,
    fetchAsset: async (url) => {
      calls.fetched.push(url)
      return { kind: "ok", bytes: buildValidPng() }
    },
    ensureOffscreenDocument: async () => {
      calls.ensureOffscreen += 1
    },
    sendMessage: async (message) => {
      calls.sent.push(message)
      const job = message as OffscreenJobMessage
      return { version: MESSAGE_VERSION, type: "offscreen_ack", nonce: job.nonce }
    },
    now: () => NOW,
    ...overrides,
  }
  return { deps, calls, jobStore }
}

describe("background initiate handler", () => {
  it("fetches the asset, sends an offscreen job, and completes the operation", async () => {
    const { deps, calls, jobStore } = createDeps()
    const message = validInitiateMessage()
    const result = await handleInitiateOperation(message, deps)
    expect(result).toEqual({
      version: MESSAGE_VERSION,
      type: "operation_accepted",
      nonce: message.nonce,
    })
    expect(calls.fetched).toEqual(["https://chatgpt.com/asset/1.png"])
    expect(calls.ensureOffscreen).toBe(1)
    expect(calls.sent).toHaveLength(1)
    const job = calls.sent[0]
    expect(job).toBeDefined()
    if (job !== undefined) {
      const offscreenJob = job as OffscreenJobMessage
      expect(offscreenJob).toMatchObject({
        version: MESSAGE_VERSION,
        type: "offscreen_job",
        nonce: message.nonce,
        providerSystemLabel: "ChatGPT",
        prompt: "a cute corgi",
      })
      expect(offscreenJob.pngBytes).toBeInstanceOf(ArrayBuffer)
    }
    expect(await jobStore.get(message.nonce)).toEqual({
      kind: "rejected",
      error: { code: "JOB_NOT_FOUND" },
    })
  })

  it("rejects a replayed nonce without fetching", async () => {
    const { deps, calls } = createDeps()
    const message = validInitiateMessage()
    await handleInitiateOperation(message, deps)
    const second = await handleInitiateOperation(message, deps)
    expect(second).toEqual({
      version: MESSAGE_VERSION,
      type: "operation_rejected",
      nonce: message.nonce,
      error: { code: "operation_cancelled" },
    })
    expect(calls.fetched).toHaveLength(1)
  })

  it("maps a denied redirect to download_failed and rejects the job", async () => {
    const { deps, calls, jobStore } = createDeps({
      fetchAsset: async () => ({ kind: "rejected", error: { code: "ASSET_REDIRECT_DENIED" } }),
    })
    const message = validInitiateMessage()
    const result = await handleInitiateOperation(message, deps)
    expect(result).toEqual({
      version: MESSAGE_VERSION,
      type: "operation_rejected",
      nonce: message.nonce,
      error: { code: "download_failed" },
    })
    expect(calls.sent).toHaveLength(0)
    expect(await jobStore.get(message.nonce)).toEqual({
      kind: "rejected",
      error: { code: "JOB_NOT_FOUND" },
    })
  })

  it("maps an oversized asset to input_too_large", async () => {
    const { deps } = createDeps({
      fetchAsset: async () => ({
        kind: "rejected",
        error: { code: "ASSET_TOO_LARGE", actualBytes: 200, limitBytes: 100 },
      }),
    })
    const message = validInitiateMessage()
    const result = await handleInitiateOperation(message, deps)
    expect(result).toEqual({
      version: MESSAGE_VERSION,
      type: "operation_rejected",
      nonce: message.nonce,
      error: { code: "input_too_large", actualBytes: 200, limitBytes: 100 },
    })
  })

  it("propagates a typed rejection from the offscreen document", async () => {
    const { deps } = createDeps({
      sendMessage: async () => ({
        version: MESSAGE_VERSION,
        type: "operation_rejected",
        nonce: NONCE,
        error: { code: "invalid_png", reason: "output_reparse_PNG_CRC_MISMATCH" },
      }),
    })
    const message = validInitiateMessage()
    const result = await handleInitiateOperation(message, deps)
    expect(result).toEqual({
      version: MESSAGE_VERSION,
      type: "operation_rejected",
      nonce: message.nonce,
      error: { code: "invalid_png", reason: "output_reparse_PNG_CRC_MISMATCH" },
    })
  })

  it("cancels when the offscreen ack is not parseable", async () => {
    const { deps, jobStore } = createDeps({
      sendMessage: async () => ({ version: 99, type: "exploit" }),
    })
    const message = validInitiateMessage()
    const result = await handleInitiateOperation(message, deps)
    expect(result).toEqual({
      version: MESSAGE_VERSION,
      type: "operation_rejected",
      nonce: message.nonce,
      error: { code: "operation_cancelled" },
    })
    expect(await jobStore.get(message.nonce)).toEqual({
      kind: "rejected",
      error: { code: "JOB_NOT_FOUND" },
    })
  })

  it("cancels and rejects the job when the offscreen document cannot be created", async () => {
    const { deps, jobStore } = createDeps({
      ensureOffscreenDocument: async () => {
        throw new Error("offscreen unavailable")
      },
    })
    const message = validInitiateMessage()
    const result = await handleInitiateOperation(message, deps)
    expect(result).toEqual({
      version: MESSAGE_VERSION,
      type: "operation_rejected",
      nonce: message.nonce,
      error: { code: "operation_cancelled" },
    })
    expect(await jobStore.get(message.nonce)).toEqual({
      kind: "rejected",
      error: { code: "JOB_NOT_FOUND" },
    })
  })

  it("cancels when the job cannot be opened", async () => {
    const { deps, calls, jobStore } = createDeps()
    const message = validInitiateMessage()
    await jobStore.open(message.nonce, unixMilliseconds(NOW + LIMITS.operationExpiryMilliseconds))
    const result = await handleInitiateOperation(message, deps)
    expect(result).toEqual({
      version: MESSAGE_VERSION,
      type: "operation_rejected",
      nonce: message.nonce,
      error: { code: "operation_cancelled" },
    })
    expect(calls.fetched).toHaveLength(0)
  })
})
