import type { ProviderImage } from "../types"

const GROK_ASSET_PATTERN =
  /^https:\/\/assets\.grok\.com\/users\/[^/]+\/generated\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/image\.(?:jpg|jpeg|png|webp)(?:\?[^#]*)?$/iu

class GrokDownloadError extends Error {
  override readonly name = "GrokDownloadError"
}

/** Grok's CDN requires the authenticated page context for generated assets. */
export async function readGrokImageBytes(
  image: ProviderImage,
): Promise<readonly number[] | undefined> {
  const source = image.candidate.sourceUrl
  if (!GROK_ASSET_PATTERN.test(source)) return undefined
  try {
    const response = await fetch(source, { credentials: "include" })
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
    if (contentType !== undefined && !["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
      throw new Error(`unsupported media type ${contentType}`)
    }
    return [...new Uint8Array(await response.arrayBuffer())]
  } catch (error) {
    throw new GrokDownloadError(
      error instanceof Error
        ? `Could not read the generated Grok image: ${error.message}.`
        : "Could not read the generated Grok image.",
    )
  }
}
