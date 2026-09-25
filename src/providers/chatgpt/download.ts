import type { ProviderImage } from "../types"

class ChatGptDownloadError extends Error {
  override readonly name = "ChatGptDownloadError"
}

/** ChatGPT now renders generated images through same-origin blob URLs. */
export async function readChatGptImageBytes(
  image: ProviderImage,
): Promise<readonly number[] | undefined> {
  const source = image.candidate.sourceUrl
  if (!source.startsWith("blob:")) return undefined
  try {
    const response = await fetch(source)
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
    return [...new Uint8Array(await response.arrayBuffer())]
  } catch (error) {
    throw new ChatGptDownloadError(
      error instanceof Error
        ? `Could not read the generated ChatGPT image: ${error.message}.`
        : "Could not read the generated ChatGPT image.",
    )
  }
}
