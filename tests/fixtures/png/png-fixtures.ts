import { deflateSync } from "node:zlib"
import { crc32Chunk } from "../../../src/metadata/crc32"

export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const chunk = new Uint8Array(12 + data.byteLength)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.byteLength, false)
  chunk.set(typeBytes, 4)
  chunk.set(data, 8)
  view.setUint32(8 + data.byteLength, crc32Chunk(typeBytes, data), false)
  return chunk
}

export function makeIhdr(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13)
  const view = new DataView(data.buffer)
  view.setUint32(0, width, false)
  view.setUint32(4, height, false)
  data[8] = 8
  data[9] = 6
  data[10] = 0
  data[11] = 0
  data[12] = 0
  return makeChunk("IHDR", data)
}

export function compressZlib(data: Uint8Array): Uint8Array {
  return deflateSync(data)
}

export function makeItxt(
  keyword: string,
  text: Uint8Array,
  options?: {
    readonly compressed?: boolean
    readonly language?: string
    readonly translatedKeyword?: string
  },
): Uint8Array {
  const keywordBytes = new TextEncoder().encode(keyword)
  const language = new TextEncoder().encode(options?.language ?? "")
  const translated = new TextEncoder().encode(options?.translatedKeyword ?? "")
  const compressed = options?.compressed ?? false
  const flag = compressed ? 1 : 0
  const dataLength =
    keywordBytes.byteLength +
    1 +
    1 +
    (compressed ? 1 : 0) +
    language.byteLength +
    1 +
    translated.byteLength +
    1 +
    text.byteLength
  const data = new Uint8Array(dataLength)
  let pos = 0
  data.set(keywordBytes, pos)
  pos += keywordBytes.byteLength
  data[pos] = 0
  pos += 1
  data[pos] = flag
  pos += 1
  if (compressed) {
    data[pos] = 0
    pos += 1
  }
  data.set(language, pos)
  pos += language.byteLength
  data[pos] = 0
  pos += 1
  data.set(translated, pos)
  pos += translated.byteLength
  data[pos] = 0
  pos += 1
  data.set(text, pos)
  return makeChunk("iTXt", data)
}

export function makeXmpItxt(
  text: Uint8Array,
  options?: {
    readonly compressed?: boolean
    readonly language?: string
    readonly translatedKeyword?: string
  },
): Uint8Array {
  const payload = options?.compressed === true ? compressZlib(text) : text
  return makeItxt("XML:com.adobe.xmp", payload, options)
}

export function makeIdat(data?: Uint8Array): Uint8Array {
  return makeChunk("IDAT", data ?? new Uint8Array([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]))
}

export function makeIend(): Uint8Array {
  return makeChunk("IEND", new Uint8Array(0))
}

export function buildPng(chunks: readonly Uint8Array[]): Uint8Array {
  const total = PNG_SIGNATURE.byteLength + chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const output = new Uint8Array(total)
  output.set(PNG_SIGNATURE, 0)
  let pos = PNG_SIGNATURE.byteLength
  for (const chunk of chunks) {
    output.set(chunk, pos)
    pos += chunk.byteLength
  }
  return output
}

export function buildValidPng(options?: {
  readonly width?: number
  readonly height?: number
  readonly ancillary?: readonly Uint8Array[]
  readonly idatCount?: number
}): Uint8Array {
  const width = options?.width ?? 1
  const height = options?.height ?? 1
  const idatCount = options?.idatCount ?? 1
  const idats = Array.from({ length: idatCount }, () => makeIdat())
  return buildPng([makeIhdr(width, height), ...(options?.ancillary ?? []), ...idats, makeIend()])
}

export function findChunkCrcOffset(png: Uint8Array, type: string): number {
  let offset = PNG_SIGNATURE.byteLength
  while (offset < png.byteLength) {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    const length = view.getUint32(offset, false)
    const chunkType = String.fromCharCode(
      png[offset + 4] ?? 0,
      png[offset + 5] ?? 0,
      png[offset + 6] ?? 0,
      png[offset + 7] ?? 0,
    )
    if (chunkType === type) return offset + 8 + length
    offset += 12 + length
  }
  return -1
}
