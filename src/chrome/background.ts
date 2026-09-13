import {
  type EnrichmentError,
  LIMITS,
  type OperationNonce,
  type Provider,
  type UnixMilliseconds,
  unixMilliseconds,
} from "../shared/contracts"
import {
  type InitiateOperationMessage,
  MESSAGE_VERSION,
  type MessageRejectedMessage,
  type MessageRejection,
  OFFSCREEN_DOCUMENT_PATH,
  type OffscreenJobMessage,
  type OperationAcceptedMessage,
  type OperationRejectedMessage,
  parseInboundMessage,
  validateMessageSender,
} from "../shared/messages"
import { NonceRegistry } from "../shared/nonce-registry"
import { PRODUCTION_ASSET_POLICY } from "./asset-policy"
import { type AssetFetchError, type AssetFetcher, createAssetFetcher } from "./download-coordinator"
import { JobStore, type JobStoreDeps } from "./job-store"

// Wiring constants for the production asset fetcher. LIMITS in contracts.ts is
// frozen by the task-6 boundary, so these live here.
const ASSET_FETCH_TIMEOUT_MILLISECONDS = 30_000
const ASSET_FETCH_RETRY_COUNT = 1

class UnreachableProviderError extends Error {
  readonly name = "UnreachableProviderError"
}

function assertNever(value: never): never {
  throw new UnreachableProviderError(`unexpected provider: ${String(value)}`)
}

function providerSystemLabel(provider: Provider): string {
  switch (provider) {
    case "chatgpt":
      return "ChatGPT"
    case "gemini":
      return "Google Gemini"
    case "grok":
      return "Grok"
    default:
      return assertNever(provider)
  }
}

export type BackgroundDeps = {
  readonly nonceRegistry: NonceRegistry
  readonly jobStore: JobStore
  readonly fetchAsset: AssetFetcher
  readonly ensureOffscreenDocument: () => Promise<void>
  readonly sendMessage: (message: OffscreenJobMessage) => Promise<unknown>
  readonly now: () => UnixMilliseconds
}

// Ephemeral replay guard only; no required operation state lives in globals so
// the service worker stays suspend-safe. Expiring job state lives in the store.
const nonceRegistry = new NonceRegistry(() => unixMilliseconds(Date.now()))

async function ensureOffscreenDocument(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })
  if (contexts.length > 0) return
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["BLOBS"],
    justification: "Transform PNG bytes into a Blob for the downloads API.",
  })
}

function acceptedResponse(nonce: OperationNonce): OperationAcceptedMessage {
  return { version: MESSAGE_VERSION, type: "operation_accepted", nonce }
}

function rejectedResponse(nonce: OperationNonce, error: EnrichmentError): OperationRejectedMessage {
  return { version: MESSAGE_VERSION, type: "operation_rejected", nonce, error }
}

function messageRejectedResponse(reason: MessageRejection): MessageRejectedMessage {
  return { version: MESSAGE_VERSION, type: "message_rejected", reason }
}

function mapAssetError(error: AssetFetchError): EnrichmentError {
  switch (error.code) {
    case "ASSET_NOT_HTTPS":
    case "ASSET_FORBIDDEN_HOST":
    case "ASSET_HOST_NOT_ALLOWED":
    case "ASSET_PATH_NOT_ALLOWED":
    case "ASSET_REDIRECT_DENIED":
    case "ASSET_FETCH_FAILED":
      return { code: "download_failed" }
    case "ASSET_BAD_STATUS":
      return { code: "download_failed", status: error.status }
    case "ASSET_TIMEOUT":
    case "ASSET_CANCELLED":
      return { code: "operation_cancelled" }
    case "ASSET_TOO_LARGE":
      return {
        code: "input_too_large",
        actualBytes: error.actualBytes,
        limitBytes: error.limitBytes,
      }
    case "ASSET_BAD_MEDIA_TYPE":
    case "ASSET_NOT_PNG":
      return { code: "unsupported_media_type", mediaType: error.mediaType }
  }
}

async function rejectJob(
  deps: BackgroundDeps,
  nonce: OperationNonce,
  error: EnrichmentError,
): Promise<OperationRejectedMessage> {
  await deps.jobStore.reject(nonce)
  return rejectedResponse(nonce, error)
}

export async function handleInitiateOperation(
  message: InitiateOperationMessage,
  deps: BackgroundDeps,
): Promise<OperationAcceptedMessage | OperationRejectedMessage> {
  const expiresAt = unixMilliseconds(message.createdAt + LIMITS.operationExpiryMilliseconds)
  const registered = deps.nonceRegistry.register(message.nonce, expiresAt)
  if (registered.kind === "rejected") {
    return rejectedResponse(message.nonce, { code: "operation_cancelled" })
  }
  await deps.jobStore.cleanup(deps.now())
  const opened = await deps.jobStore.open(message.nonce, expiresAt)
  if (opened.kind === "rejected") {
    return rejectedResponse(message.nonce, { code: "operation_cancelled" })
  }
  try {
    await deps.ensureOffscreenDocument()
    const fetched = await deps.fetchAsset(message.imageCandidate.sourceUrl)
    if (fetched.kind === "rejected") {
      return rejectJob(deps, message.nonce, mapAssetError(fetched.error))
    }
    const job: OffscreenJobMessage = {
      version: MESSAGE_VERSION,
      type: "offscreen_job",
      nonce: message.nonce,
      providerSystemLabel: providerSystemLabel(message.promptCapture.provider),
      prompt: message.promptCapture.originalPrompt,
      pngBytes: fetched.bytes.slice().buffer,
    }
    const marked = await deps.jobStore.markDownloading(message.nonce)
    if (marked.kind === "rejected") {
      return rejectJob(deps, message.nonce, { code: "operation_cancelled" })
    }
    const ack: unknown = await deps.sendMessage(job)
    const parsedAck = parseInboundMessage(ack, deps.now())
    if (parsedAck.kind === "rejected") {
      return rejectJob(deps, message.nonce, { code: "operation_cancelled" })
    }
    if (parsedAck.message.type === "operation_rejected") {
      return rejectJob(deps, message.nonce, parsedAck.message.error)
    }
    if (parsedAck.message.type !== "offscreen_ack") {
      return rejectJob(deps, message.nonce, { code: "operation_cancelled" })
    }
    await deps.jobStore.complete(message.nonce)
    deps.nonceRegistry.consume(message.nonce)
    return acceptedResponse(message.nonce)
  } catch {
    return rejectJob(deps, message.nonce, { code: "operation_cancelled" })
  }
}

if (typeof chrome !== "undefined") {
  const storage: JobStoreDeps["storage"] = {
    get: async (key) => (await chrome.storage.local.get(key))[key],
    getAll: async () => chrome.storage.local.get(),
    set: async (key, value) => {
      await chrome.storage.local.set({ [key]: value })
    },
    remove: async (key) => {
      await chrome.storage.local.remove(key)
    },
  }
  const productionDeps: BackgroundDeps = {
    nonceRegistry,
    jobStore: new JobStore({ storage, clock: () => unixMilliseconds(Date.now()) }),
    fetchAsset: createAssetFetcher({
      policy: PRODUCTION_ASSET_POLICY,
      fetchImpl: (url, init) => fetch(url, init),
      maxBytes: LIMITS.maxInputBytes,
      timeoutMilliseconds: ASSET_FETCH_TIMEOUT_MILLISECONDS,
      retryCount: ASSET_FETCH_RETRY_COUNT,
    }),
    ensureOffscreenDocument,
    sendMessage: (job) => chrome.runtime.sendMessage(job),
    now: () => unixMilliseconds(Date.now()),
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const senderResult = validateMessageSender(sender, chrome.runtime.id)
    if (senderResult.kind === "rejected") {
      sendResponse(messageRejectedResponse(senderResult.error))
      return
    }
    const parseResult = parseInboundMessage(message, unixMilliseconds(Date.now()))
    if (parseResult.kind === "rejected") {
      sendResponse(messageRejectedResponse(parseResult.error))
      return
    }
    switch (parseResult.message.type) {
      case "initiate_operation": {
        const initiate = parseResult.message
        void handleInitiateOperation(initiate, productionDeps).then(sendResponse, () => {
          sendResponse(rejectedResponse(initiate.nonce, { code: "operation_cancelled" }))
        })
        return true
      }
      default:
        sendResponse(messageRejectedResponse({ code: "MESSAGE_UNKNOWN_TYPE" }))
        return
    }
  })
}
