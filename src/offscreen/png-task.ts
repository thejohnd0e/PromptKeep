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
  readonly model?: string
}

export type PngTaskResult =
  | { readonly kind: "ok"; readonly message: OffscreenAckMessage }
  | { readonly kind: "rejected"; readonly message: OperationRejectedMessage }

export type PngTaskDeps = {
  readonly loadAsset: (nonce: OperationNonce) => Promise<Uint8Array | undefined>
  readonly rasterToPng?: (input: Uint8Array) => Promise<Uint8Array>
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

function isPngSignature(input: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
  if (input.byteLength < signature.length) return false
  return signature.every((byte, index) => input[index] === byte)
}

function detectMediaType(input: Uint8Array): string {
  if (input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return "image/jpeg"
  if (
    input[0] === 0x52 &&
    input[1] === 0x49 &&
    input[2] === 0x46 &&
    input[3] === 0x46 &&
    input[8] === 0x57 &&
    input[9] === 0x45 &&
    input[10] === 0x42 &&
    input[11] === 0x50
  ) {
    return "image/webp"
  }
  if (input[0] === 0x47 && input[1] === 0x49 && input[2] === 0x46) return "image/gif"
  return "application/octet-stream"
}

async function rasterToPng(input: Uint8Array): Promise<Uint8Array> {
  if (isPngSignature(input)) return input
  const image = await createImageBitmap(new Blob([input.slice()]))
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(image.width, image.height)
      const context = canvas.getContext("2d")
      if (context === null) throw new Error("2d context unavailable")
      context.drawImage(image, 0, 0)
      return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer())
    }
    const canvas = document.createElement("canvas")
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext("2d")
    if (context === null) throw new Error("2d context unavailable")
    context.drawImage(image, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
    if (blob === null) throw new Error("png conversion failed")
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    image.close()
  }
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
  const input = await deps.loadAsset(request.nonce)
  if (input === undefined) return rejected(request.nonce, { code: "operation_cancelled" })
  let pngInput: Uint8Array
  try {
    pngInput = await (deps.rasterToPng ?? rasterToPng)(input)
  } catch {
    return rejected(request.nonce, {
      code: "unsupported_media_type",
      mediaType: detectMediaType(input),
    })
  }
  const enriched = enrichPng(
    pngInput,
    {
      provider,
      originalPrompt: request.prompt,
       ...(request.sourceUrl === undefined ? {} : { sourceUrl: request.sourceUrl }),
       ...(request.model === undefined ? {} : { model: request.model }),
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
