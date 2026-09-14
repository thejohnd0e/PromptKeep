import { readdir } from "node:fs/promises"
import { join } from "node:path"

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

export type PngChunk = {
  readonly type: string
  readonly data: Uint8Array
}

export type ExifMetadata = {
  readonly imageDescription: string | undefined
  readonly software: string | undefined
  readonly userComment: string | undefined
  readonly xpComment: string | undefined
}

type TiffEntry = {
  readonly offset: number
  readonly type: number
  readonly count: number
}

/**
 * Independent PNG chunk parser for E2E assertions. Test infrastructure only —
 * it never imports production source, so the downloaded bytes are verified
 * against a second implementation.
 */
export function parsePngChunks(bytes: Uint8Array): PngChunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < 8; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error("not a PNG")
  }
  const chunks: PngChunk[] = []
  let offset = 8
  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset, false)
    const type = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    )
    const data = bytes.slice(offset + 8, offset + 8 + length)
    chunks.push({ type, data })
    offset += 12 + length
    if (type === "IEND") break
  }
  return chunks
}

export function findXmpItxt(chunks: readonly PngChunk[]): PngChunk | undefined {
  return chunks.find((chunk) => {
    if (chunk.type !== "iTXt") return false
    const keywordEnd = chunk.data.indexOf(0)
    const keyword = Buffer.from(chunk.data.slice(0, keywordEnd)).toString("utf8")
    return keyword === "XML:com.adobe.xmp"
  })
}

/** Reads the UTF-8 text of an iTXt chunk by its exact keyword. */
export function findItxtText(chunks: readonly PngChunk[], keyword: string): string | undefined {
  const chunk = chunks.find((candidate) => {
    if (candidate.type !== "iTXt") return false
    const keywordEnd = candidate.data.indexOf(0)
    return Buffer.from(candidate.data.slice(0, keywordEnd)).toString("utf8") === keyword
  })
  if (chunk === undefined) return undefined
  const keywordEnd = chunk.data.indexOf(0)
  // keyword NUL, compression flag, compression method, language NUL, translated NUL
  return Buffer.from(chunk.data.slice(keywordEnd + 5)).toString("utf8")
}

/** Reads the text of a tEXt chunk by its exact keyword, independent of production code. */
export function findTextChunk(chunks: readonly PngChunk[], keyword: string): string | undefined {
  const chunk = chunks.find((candidate) => {
    if (candidate.type !== "tEXt") return false
    const keywordEnd = candidate.data.indexOf(0)
    return Buffer.from(candidate.data.slice(0, keywordEnd)).toString("utf8") === keyword
  })
  if (chunk === undefined) return undefined
  const keywordEnd = chunk.data.indexOf(0)
  return Buffer.from(chunk.data.slice(keywordEnd + 1)).toString("utf8")
}

function tiffEntries(
  data: Uint8Array,
  ifdOffset: number,
  littleEndian: boolean,
): Map<number, TiffEntry> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const count = view.getUint16(ifdOffset, littleEndian)
  const entries = new Map<number, TiffEntry>()
  for (let index = 0; index < count; index += 1) {
    const offset = ifdOffset + 2 + index * 12
    entries.set(view.getUint16(offset, littleEndian), {
      offset,
      type: view.getUint16(offset + 2, littleEndian),
      count: view.getUint32(offset + 4, littleEndian),
    })
  }
  return entries
}

function tiffValue(
  data: Uint8Array,
  entry: TiffEntry | undefined,
  littleEndian: boolean,
): Uint8Array | undefined {
  if (entry === undefined) return undefined
  const width = entry.type === 4 ? 4 : 1
  const length = entry.count * width
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const offset = length <= 4 ? entry.offset + 8 : view.getUint32(entry.offset + 8, littleEndian)
  return data.slice(offset, offset + length)
}

function decodedText(data: Uint8Array | undefined, encoding: string): string | undefined {
  if (data === undefined) return undefined
  return new TextDecoder(encoding).decode(data).replace(/\0+$/u, "")
}

export function readExifMetadata(data: Uint8Array): ExifMetadata {
  const littleEndian = data[0] === 0x49 && data[1] === 0x49
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const ifd0 = tiffEntries(data, view.getUint32(4, littleEndian), littleEndian)
  const exifPointer = ifd0.get(0x8769)
  const exifIfdOffset =
    exifPointer === undefined ? undefined : view.getUint32(exifPointer.offset + 8, littleEndian)
  const exifIfd =
    exifIfdOffset === undefined
      ? new Map<number, TiffEntry>()
      : tiffEntries(data, exifIfdOffset, littleEndian)
  const userCommentBytes = tiffValue(data, exifIfd.get(0x9286), littleEndian)
  const userCommentText = userCommentBytes?.slice(8)
  return {
    imageDescription: decodedText(tiffValue(data, ifd0.get(0x010e), littleEndian), "ascii"),
    software: decodedText(tiffValue(data, ifd0.get(0x0131), littleEndian), "ascii"),
    userComment: decodedText(userCommentText, littleEndian ? "utf-16le" : "utf-16be"),
    xpComment: decodedText(tiffValue(data, ifd0.get(0x9c9c), littleEndian), "utf-16le"),
  }
}

export function xmpValue(xmp: string, tag: string): string | undefined {
  const match = new RegExp(`<(?:[^:<>]+:)?${tag}>([^<]*)</(?:[^:<>]+:)?${tag}>`, "u").exec(xmp)
  return match?.[1]
}

export async function waitForDownload(
  downloadsPath: string,
  before: readonly string[],
  timeoutMilliseconds = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMilliseconds
  for (;;) {
    const entries = await readdir(downloadsPath)
    const fresh = entries.filter(
      (name) => !before.includes(name) && name.endsWith(".png") && !name.endsWith(".crdownload"),
    )
    if (fresh.length > 0) {
      return join(downloadsPath, fresh[0] ?? "")
    }
    if (Date.now() > deadline) {
      throw new Error(
        `no download appeared within ${timeoutMilliseconds}ms; dir: ${entries.join(", ")}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

export async function listDownloads(downloadsPath: string): Promise<string[]> {
  return readdir(downloadsPath)
}
