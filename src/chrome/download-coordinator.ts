import { PNG_SIGNATURE } from "../metadata/png-parser"
import { type ImageUrl, imageUrl } from "../shared/contracts"
import type { AssetPolicy } from "./asset-policy"

export type AssetFetchError =
  | { readonly code: "ASSET_NOT_HTTPS" }
  | { readonly code: "ASSET_FORBIDDEN_HOST"; readonly hostname: string }
  | { readonly code: "ASSET_HOST_NOT_ALLOWED"; readonly hostname: string }
  | { readonly code: "ASSET_PATH_NOT_ALLOWED"; readonly hostname: string; readonly path: string }
  | { readonly code: "ASSET_REDIRECT_DENIED" }
  | { readonly code: "ASSET_FETCH_FAILED" }
  | { readonly code: "ASSET_TIMEOUT" }
  | { readonly code: "ASSET_CANCELLED" }
  | { readonly code: "ASSET_TOO_LARGE"; readonly actualBytes: number; readonly limitBytes: number }
  | { readonly code: "ASSET_BAD_STATUS"; readonly status: number }
  | { readonly code: "ASSET_BAD_MEDIA_TYPE"; readonly mediaType: string }
  | { readonly code: "ASSET_NOT_PNG"; readonly mediaType: string }

export type AssetFetchResult =
  | { readonly kind: "ok"; readonly bytes: Uint8Array }
  | { readonly kind: "rejected"; readonly error: AssetFetchError }

export type AssetFetcher = (sourceUrl: ImageUrl, signal?: AbortSignal) => Promise<AssetFetchResult>

export type AssetFetcherDeps = {
  readonly policy: AssetPolicy
  readonly fetchImpl: (url: string, init?: RequestInit) => Promise<Response>
  readonly maxBytes: number
  readonly timeoutMilliseconds: number
  readonly retryCount: number
}

export type DownloadOptions = {
  readonly url: string
  readonly filename?: string
  readonly conflictAction?: "uniquify" | "overwrite" | "prompt"
  readonly saveAs?: boolean
}

export type DownloadOutcome =
  | { readonly kind: "completed" }
  | { readonly kind: "interrupted"; readonly error?: string }

export type DownloadError =
  | { readonly code: "DOWNLOAD_FAILED"; readonly reason?: string }
  | { readonly code: "DOWNLOAD_CANCELLED" }

export type DownloadResult =
  | { readonly kind: "ok"; readonly downloadId: number }
  | { readonly kind: "rejected"; readonly error: DownloadError }

export type Downloader = (sourceUrl: string, filenameBase: string) => Promise<DownloadResult>

export type DownloaderDeps = {
  readonly download: (options: DownloadOptions) => Promise<number>
  readonly waitForDownload: (downloadId: number) => Promise<DownloadOutcome>
}

const FORBIDDEN_FILENAME_CHARS = /[<>:"/\\|?*]/u
const MAX_REDIRECTS = 5

export function sanitizeFilenameBase(value: string): string {
  const stripped = value
    .split("")
    .filter((char) => char.charCodeAt(0) >= 32 && !FORBIDDEN_FILENAME_CHARS.test(char))
    .join("")
    .trim()
  const trimmed = stripped.replace(/^[.\s]+|[.\s]+$/gu, "")
  return trimmed === "" ? "image" : trimmed
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

function isPngSignature(input: Uint8Array): boolean {
  if (input.byteLength < PNG_SIGNATURE.byteLength) return false
  for (let i = 0; i < PNG_SIGNATURE.byteLength; i += 1) {
    if (input[i] !== PNG_SIGNATURE[i]) return false
  }
  return true
}

function detectMediaType(input: Uint8Array): string {
  if (input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return "image/jpeg"
  if (input[0] === 0x47 && input[1] === 0x49 && input[2] === 0x46) return "image/gif"
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
  return "application/octet-stream"
}

function isSupportedRasterType(mediaType: string): boolean {
  return mediaType === "image/png" || mediaType === "image/jpeg" || mediaType === "image/webp"
}

async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<{ kind: "ok"; bytes: Uint8Array } | { kind: "too_large"; actualBytes: number }> {
  if (body === null) throw new Error("response body missing")
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return { kind: "too_large", actualBytes: total }
    }
    chunks.push(value)
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { kind: "ok", bytes: output }
}

async function fetchAssetOnce(
  deps: AssetFetcherDeps,
  sourceUrl: ImageUrl,
  signal: AbortSignal | undefined,
  redirectCount = 0,
): Promise<AssetFetchResult> {
  if (isAborted(signal)) {
    return { kind: "rejected", error: { code: "ASSET_CANCELLED" } }
  }
  const controller = new AbortController()
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, deps.timeoutMilliseconds)
  const onAbort = () => controller.abort()
  signal?.addEventListener("abort", onAbort, { once: true })
  try {
    let response: Response
    try {
      response = await deps.fetchImpl(sourceUrl, {
        credentials: "include",
        redirect: "manual",
        signal: controller.signal,
      })
    } catch {
      if (timedOut) return { kind: "rejected", error: { code: "ASSET_TIMEOUT" } }
      if (isAborted(signal)) return { kind: "rejected", error: { code: "ASSET_CANCELLED" } }
      return { kind: "rejected", error: { code: "ASSET_FETCH_FAILED" } }
    }
    if (response.type === "opaqueredirect") {
      return { kind: "rejected", error: { code: "ASSET_REDIRECT_DENIED" } }
    }
    if (response.status >= 300 && response.status < 400) {
      if (redirectCount >= MAX_REDIRECTS) {
        return { kind: "rejected", error: { code: "ASSET_REDIRECT_DENIED" } }
      }
      const location = response.headers.get("location")
      if (location === null) {
        return { kind: "rejected", error: { code: "ASSET_REDIRECT_DENIED" } }
      }
      const nextUrl = new URL(location, sourceUrl).toString()
      const policyResult = deps.policy(nextUrl)
      if (policyResult.kind === "rejected") {
        return { kind: "rejected", error: policyResult.error }
      }
      return fetchAssetOnce(deps, imageUrl(policyResult.url.toString()), signal, redirectCount + 1)
    }
    if (!response.ok) {
      return { kind: "rejected", error: { code: "ASSET_BAD_STATUS", status: response.status } }
    }
    const contentType = response.headers.get("content-type")
    if (contentType !== null) {
      const contentMediaType = contentType.split(";")[0]?.trim().toLowerCase() ?? ""
      if (!isSupportedRasterType(contentMediaType)) {
        return { kind: "rejected", error: { code: "ASSET_BAD_MEDIA_TYPE", mediaType: contentType } }
      }
    }
    const contentLength = Number(response.headers.get("content-length") ?? "0")
    if (Number.isFinite(contentLength) && contentLength > deps.maxBytes) {
      return {
        kind: "rejected",
        error: { code: "ASSET_TOO_LARGE", actualBytes: contentLength, limitBytes: deps.maxBytes },
      }
    }
    const read = await readBounded(response.body, deps.maxBytes)
    if (read.kind === "too_large") {
      return {
        kind: "rejected",
        error: {
          code: "ASSET_TOO_LARGE",
          actualBytes: read.actualBytes,
          limitBytes: deps.maxBytes,
        },
      }
    }
    const mediaType = isPngSignature(read.bytes) ? "image/png" : detectMediaType(read.bytes)
    if (!isSupportedRasterType(mediaType)) {
      return { kind: "rejected", error: { code: "ASSET_BAD_MEDIA_TYPE", mediaType } }
    }
    return { kind: "ok", bytes: read.bytes }
  } catch {
    if (timedOut) return { kind: "rejected", error: { code: "ASSET_TIMEOUT" } }
    if (isAborted(signal)) return { kind: "rejected", error: { code: "ASSET_CANCELLED" } }
    return { kind: "rejected", error: { code: "ASSET_FETCH_FAILED" } }
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener("abort", onAbort)
  }
}

export function createAssetFetcher(deps: AssetFetcherDeps): AssetFetcher {
  return async (sourceUrl, signal) => {
    const policyResult = deps.policy(sourceUrl)
    if (policyResult.kind === "rejected") {
      return { kind: "rejected", error: policyResult.error }
    }
    let result = await fetchAssetOnce(deps, sourceUrl, signal)
    for (let attempt = 0; attempt < deps.retryCount && isTransient(result); attempt += 1) {
      result = await fetchAssetOnce(deps, sourceUrl, signal)
    }
    return result
  }
}

function isTransient(result: AssetFetchResult): boolean {
  return result.kind === "rejected" && result.error.code === "ASSET_FETCH_FAILED"
}

export function createDownloader(deps: DownloaderDeps): Downloader {
  return async (sourceUrl, filenameBase) => {
    const filename = `${sanitizeFilenameBase(filenameBase)}-ai-prompt.png`
    try {
      const downloadId = await deps.download({
        url: sourceUrl,
        filename,
        conflictAction: "uniquify",
      })
      const outcome = await deps.waitForDownload(downloadId)
      if (outcome.kind === "interrupted") {
        const error: DownloadError =
          outcome.error === "USER_CANCELED"
            ? { code: "DOWNLOAD_CANCELLED" }
            : {
                code: "DOWNLOAD_FAILED",
                ...(outcome.error === undefined ? {} : { reason: outcome.error }),
              }
        return { kind: "rejected", error }
      }
      return { kind: "ok", downloadId }
    } catch {
      return { kind: "rejected", error: { code: "DOWNLOAD_FAILED" } }
    }
  }
}
