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
  readonly sourceUrl?: string
}

export type PngTaskResult =
  | { readonly kind: "ok"; readonly message: OffscreenAckMessage }
  | { readonly kind: "rejected"; readonly message: OperationRejectedMessage }

export type PngTaskDeps = {
  readonly loadAsset: (nonce: OperationNonce) => Promise<Uint8Array | undefined>
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

/**
 * Enriches the PNG bytes and exposes the result as a Blob URL. The offscreen
 * document is the only extension context with both DOM access (for Blob URL
 * creation) and the enrichment pipeline; the actual chrome.downloads call
 * happens in the service worker because offscreen documents can only use the
 * chrome.runtime API.
 */
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
  const input = await deps.loadAsset(request.nonce)
  if (input === undefined) return rejected(request.nonce, { code: "operation_cancelled" })
  const enriched = enrichPng(
    input,
    {
      provider,
      originalPrompt: request.prompt,
      ...(request.sourceUrl === undefined ? {} : { sourceUrl: request.sourceUrl }),
    },
    { acknowledgeCaBX: true },
  )
  if (enriched.kind === "rejected") {
    return rejected(request.nonce, mapEnrichError(enriched.error))
  }
  const blob = new Blob([enriched.value.outputBytes.slice()], { type: "image/png" })
  return {
    kind: "ok",
    message: {
      version: MESSAGE_VERSION,
      type: "offscreen_ack",
      nonce: request.nonce,
      blobUrl: URL.createObjectURL(blob),
    },
  }
}

/** Releases the Blob URL once the service worker finished the download. */
export function revokePngBlobUrl(blobUrl: string): void {
  URL.revokeObjectURL(blobUrl)
}
