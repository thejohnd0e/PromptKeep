import { type AssetTransferStore, createAssetTransferStore } from "../shared/asset-transfer"
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
  type OffscreenRevokeMessage,
  type OperationAcceptedMessage,
  type OperationRejectedMessage,
  parseInboundMessage,
  validateMessageSender,
} from "../shared/messages"
import { NonceRegistry } from "../shared/nonce-registry"
import { PRODUCTION_ASSET_POLICY } from "./asset-policy"
import {
  type AssetFetchError,
  type AssetFetcher,
  createAssetFetcher,
  createDownloader,
  type Downloader,
  type DownloadOutcome,
} from "./download-coordinator"
import { JobStore, type JobStoreDeps } from "./job-store"

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

function providerFilenameBase(provider: Provider, nonce: OperationNonce): string {
  switch (provider) {
    case "chatgpt":
      return `ChatGPT-${nonce}`
    case "gemini":
      return `Gemini-${nonce}`
    case "grok":
      return nonce
    default:
      return assertNever(provider)
  }
}

export type BackgroundDeps = {
  readonly nonceRegistry: NonceRegistry
  readonly jobStore: JobStore
  readonly fetchAsset: AssetFetcher
  readonly assetTransfer: AssetTransferStore
  readonly ensureOffscreenDocument: () => Promise<void>
  readonly sendMessage: (message: OffscreenJobMessage | OffscreenRevokeMessage) => Promise<unknown>
  readonly downloadBlobUrl: Downloader
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

function waitForDownloadCompletion(downloadId: number): Promise<DownloadOutcome> {
  return new Promise((resolve) => {
    const listener = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== downloadId) return
      if (delta.state?.current === "complete") {
        chrome.downloads.onChanged.removeListener(listener)
        resolve({ kind: "completed" })
      } else if (delta.state?.current === "interrupted") {
        chrome.downloads.onChanged.removeListener(listener)
        const error = delta.error?.current
        resolve(error === undefined ? { kind: "interrupted" } : { kind: "interrupted", error })
      }
    }
    chrome.downloads.onChanged.addListener(listener)
  })
}

function mapAssetError(error: AssetFetchError): EnrichmentError {
  switch (error.code) {
    case "ASSET_NOT_HTTPS":
    case "ASSET_FORBIDDEN_HOST":
    case "ASSET_HOST_NOT_ALLOWED":
    case "ASSET_PATH_NOT_ALLOWED":
    case "ASSET_REDIRECT_DENIED":
    case "ASSET_FETCH_FAILED":
      return { code: "download_failed", reason: error.code }
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
    if (message.imageBytes === undefined) {
      const fetched = await deps.fetchAsset(message.imageCandidate.sourceUrl)
      if (fetched.kind === "rejected") {
        return rejectJob(deps, message.nonce, mapAssetError(fetched.error))
      }
      await deps.assetTransfer.save(message.nonce, fetched.bytes)
    } else {
      await deps.assetTransfer.save(message.nonce, new Uint8Array(message.imageBytes))
    }
    const job: OffscreenJobMessage = {
      version: MESSAGE_VERSION,
      type: "offscreen_job",
      nonce: message.nonce,
      providerSystemLabel: providerSystemLabel(message.promptCapture.provider),
      prompt: message.promptCapture.originalPrompt,
       ...(message.promptCapture.sourceUrl === undefined
         ? {}
         : { sourceUrl: message.promptCapture.sourceUrl }),
       ...(message.promptCapture.model === undefined ? {} : { model: message.promptCapture.model }),
    }
    const marked = await deps.jobStore.markDownloading(message.nonce)
    if (marked.kind === "rejected") {
      return rejectJob(deps, message.nonce, { code: "operation_cancelled" })
    }
    let ack: unknown
    try {
      ack = await deps.sendMessage(job)
    } finally {
      await deps.assetTransfer.delete(message.nonce)
    }
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
    // The offscreen document can only use chrome.runtime, so it hands back a
    // Blob URL and the service worker (which owns chrome.downloads) triggers
    // and awaits the actual download.
    const download = await deps.downloadBlobUrl(
      parsedAck.message.blobUrl,
      providerFilenameBase(message.promptCapture.provider, message.nonce),
    )
    const revoke: OffscreenRevokeMessage = {
      version: MESSAGE_VERSION,
      type: "offscreen_revoke",
      nonce: message.nonce,
      blobUrl: parsedAck.message.blobUrl,
    }
    await deps.sendMessage(revoke).catch(() => undefined)
    if (download.kind === "rejected") {
      return rejectJob(
        deps,
        message.nonce,
        download.error.code === "DOWNLOAD_CANCELLED"
          ? { code: "operation_cancelled" }
          : {
              code: "download_failed",
              ...(download.error.reason === undefined ? {} : { reason: download.error.reason }),
            },
      )
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
      timeoutMilliseconds: 30_000,
      retryCount: 1,
    }),
    assetTransfer: createAssetTransferStore(caches),
    ensureOffscreenDocument,
    sendMessage: (job) => chrome.runtime.sendMessage(job),
    downloadBlobUrl: createDownloader({
      download: (options) => chrome.downloads.download(options),
      waitForDownload: waitForDownloadCompletion,
    }),
    now: () => unixMilliseconds(Date.now()),
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.tab === undefined) return
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
