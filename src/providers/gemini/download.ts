import type { ProviderImage } from "../types"

class GeminiDownloadError extends Error {
  override readonly name = "GeminiDownloadError"
}

function isByteArray(value: unknown): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry: unknown) =>
        typeof entry === "number" && Number.isInteger(entry) && entry >= 0 && entry <= 255,
    )
  )
}

let fullSizeCaptureActive = false

async function captureFullSizeImageBytes(element: Element): Promise<readonly number[] | undefined> {
  if (fullSizeCaptureActive || !(element instanceof HTMLElement)) return undefined
  fullSizeCaptureActive = true
  try {
    return await new Promise<readonly number[] | undefined>((resolve) => {
      const eventId = crypto.randomUUID()
      const script = document.createElement("script")
      let settled = false
      const timeoutId = setTimeout(() => finish(undefined), 30_000)
      const finish = (bytes: readonly number[] | undefined): void => {
        if (settled) return
        settled = true
        window.removeEventListener(eventId, handleBytes)
        clearTimeout(timeoutId)
        script.remove()
        resolve(bytes)
      }
      const handleBytes = (event: Event): void => {
        const detail: unknown = event instanceof CustomEvent ? event.detail : undefined
        if (detail === null) {
          finish(undefined)
          return
        }
        if (isByteArray(detail)) finish(detail)
      }
      script.addEventListener(
        "load",
        () => {
          if (!settled) element.click()
        },
        { once: true },
      )
      script.addEventListener("error", () => finish(undefined), { once: true })
      script.src = chrome.runtime.getURL("page-download-capture.js")
      script.dataset["aip2eEventId"] = eventId
      window.addEventListener(eventId, handleBytes)
      document.documentElement.appendChild(script)
    })
  } finally {
    fullSizeCaptureActive = false
  }
}

export async function readGeminiImageBytes(
  image: ProviderImage,
): Promise<readonly number[] | undefined> {
  if (image.fullSizeElement === undefined) {
    if (image.candidate.sourceUrl.startsWith("blob:")) {
      throw new GeminiDownloadError(
        "Gemini's full-size download control is not available. Refresh the tab and try again.",
      )
    }
    return undefined
  }
  const bytes = await captureFullSizeImageBytes(image.fullSizeElement)
  if (bytes === undefined) {
    throw new GeminiDownloadError(
      "Could not capture the full-size Gemini image. Please try Download with prompt again.",
    )
  }
  return bytes
}
