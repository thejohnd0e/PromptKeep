import type { DownloadError, Downloader } from "../chrome/download-coordinator"
import { type EnrichPngError, enrichPng } from "../metadata/enrich-png"
import type { EnrichmentError, OperationNonce, Provider } from "../shared/contracts"
import {
  MESSAGE_VERSION,
  type OffscreenAckMessage,
  type OperationRejectedMessage,
} from "../shared/messages"

export type PngTaskRequest = {
  readonly nonce: OperationNonce
  readonly providerSystemLabel: string
  readonly prompt: string
  readonly pngBytes: ArrayBuffer | Blob
  readonly filenameBase: string
  readonly acknowledgeCaBX: boolean
}

export type PngTaskResult =
  | { readonly kind: "ok"; readonly message: OffscreenAckMessage }
  | { readonly kind: "rejected"; readonly message: OperationRejectedMessage }

export type PngTaskDeps = {
  readonly downloadBytes: Downloader
}

const PROVIDER_BY_SYSTEM_LABEL: Readonly<Record<string, Provider>> = {
  ChatGPT: "chatgpt",
  "Google Gemini": "gemini",
  Grok: "grok",
}

function rejected(nonce: OperationNonce, error: EnrichmentError): PngTaskResult {
  return {
    kind: "rejected",
    message: { version: MESSAGE_VERSION, type: "operation_rejected", nonce, error },
  }
}

function mapEnrichError(error: EnrichPngError): EnrichmentError {
  switch (error.code) {
    case "C2PA_ACK_REQUIRED":
      return { code: "operation_cancelled" }
    case "xmp_invalid_value":
      return { code: "invalid_png", reason: "xmp_invalid_value" }
    default:
      return error
  }
}

function mapDownloadError(error: DownloadError): EnrichmentError {
  switch (error.code) {
    case "DOWNLOAD_CANCELLED":
      return { code: "operation_cancelled" }
    case "DOWNLOAD_FAILED":
      return { code: "download_failed" }
  }
}

async function toUint8Array(bytes: ArrayBuffer | Blob): Promise<Uint8Array> {
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes)
  return new Uint8Array(await bytes.arrayBuffer())
}

export async function runPngTask(
  request: PngTaskRequest,
  deps: PngTaskDeps,
): Promise<PngTaskResult> {
  const provider = PROVIDER_BY_SYSTEM_LABEL[request.providerSystemLabel]
  if (provider === undefined) {
    return rejected(request.nonce, {
      code: "unsupported_provider",
      provider: request.providerSystemLabel,
    })
  }
  const input = await toUint8Array(request.pngBytes)
  const enriched = enrichPng(
    input,
    { provider, originalPrompt: request.prompt },
    { acknowledgeCaBX: request.acknowledgeCaBX },
  )
  if (enriched.kind === "rejected") {
    return rejected(request.nonce, mapEnrichError(enriched.error))
  }
  const download = await deps.downloadBytes(enriched.value.outputBytes, request.filenameBase)
  if (download.kind === "rejected") {
    return rejected(request.nonce, mapDownloadError(download.error))
  }
  return {
    kind: "ok",
    message: { version: MESSAGE_VERSION, type: "offscreen_ack", nonce: request.nonce },
  }
}
