import { LIMITS } from "../shared/contracts"
import { crc32 } from "./crc32"
import {
  type PngChunkDescriptor,
  type PngFailure,
  type PngParseResult,
  type PngResult,
  pngRejected,
} from "./png-types"
import { extractXmp } from "./png-xmp"

export {
  type PngChunkDescriptor,
  type PngFailure,
  type PngParseResult,
  type PngResult,
  type PngXmpPacket,
  pngRejected,
} from "./png-types"

export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const APNG_CHUNKS = new Set(["acTL", "fcTL", "fdAT"])
const KNOWN_CRITICAL = new Set(["IHDR", "IDAT", "IEND"])

function isCritical(type: string): boolean {
  return (type.charCodeAt(0) & 0x20) === 0
}

function chunkType(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

export function parsePng(input: Uint8Array): PngResult<PngParseResult> {
  if (input.byteLength < PNG_SIGNATURE.byteLength) {
    return pngRejected({ code: "PNG_INVALID_SIGNATURE" })
  }
  for (let i = 0; i < PNG_SIGNATURE.byteLength; i++) {
    if (input[i] !== PNG_SIGNATURE[i]) return pngRejected({ code: "PNG_INVALID_SIGNATURE" })
  }

  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const chunks: PngChunkDescriptor[] = []
  let structuralError: PngFailure | undefined
  let ihdrIndex = -1
  let ihdrCount = 0
  let idatStart = -1
  let idatEnd = -1
  let iendIndex = -1
  let apngType: string | undefined
  let unknownCritical: string | undefined
  let offset = 8

  while (offset < input.byteLength) {
    const chunkIndex = chunks.length
    if (chunkIndex >= LIMITS.maxPngChunks) {
      structuralError = {
        code: "PNG_TOO_MANY_CHUNKS",
        actualChunks: chunkIndex,
        limitChunks: LIMITS.maxPngChunks,
      }
      break
    }
    if (offset + 12 > input.byteLength) {
      structuralError = {
        code: "PNG_TRUNCATED",
        chunkIndex,
        expectedBytes: offset + 12,
        actualBytes: input.byteLength,
      }
      break
    }
    const length = view.getUint32(offset, false)
    if (
      !Number.isSafeInteger(offset + 8 + length) ||
      !Number.isSafeInteger(offset + 8 + length + 4)
    ) {
      structuralError = {
        code: "PNG_CHUNK_LENGTH_OVERFLOW",
        chunkIndex,
        length,
        limitBytes: LIMITS.maxInputBytes,
      }
      break
    }
    if (length > LIMITS.maxInputBytes) {
      structuralError = {
        code: "PNG_CHUNK_LENGTH_OVERFLOW",
        chunkIndex,
        length,
        limitBytes: LIMITS.maxInputBytes,
      }
      break
    }
    const type = chunkType(view, offset + 4)
    const dataOffset = offset + 8
    const crcOffset = dataOffset + length
    const chunkEnd = crcOffset + 4
    if (chunkEnd > input.byteLength) {
      structuralError = {
        code: "PNG_TRUNCATED",
        chunkIndex,
        expectedBytes: chunkEnd,
        actualBytes: input.byteLength,
      }
      break
    }
    const crc = view.getUint32(crcOffset, false)
    chunks.push({ type, index: chunkIndex, offset, length, dataOffset, crcOffset, crc })
    if (type === "IHDR") {
      ihdrCount += 1
      if (ihdrIndex === -1) ihdrIndex = chunkIndex
    }
    if (type === "IDAT") {
      if (idatStart === -1) idatStart = chunkIndex
      idatEnd = chunkIndex
    }
    if (type === "IEND") iendIndex = chunkIndex
    if (APNG_CHUNKS.has(type) && apngType === undefined) apngType = type
    if (isCritical(type) && !KNOWN_CRITICAL.has(type) && unknownCritical === undefined)
      unknownCritical = type
    offset = chunkEnd
  }

  if (ihdrCount === 0) return pngRejected({ code: "PNG_IHDR_MISSING" })
  if (ihdrCount > 1) return pngRejected({ code: "PNG_IHDR_DUPLICATE" })
  if (ihdrIndex !== 0) return pngRejected({ code: "PNG_IHDR_NOT_FIRST" })

  if (structuralError !== undefined) return pngRejected(structuralError)

  for (const chunk of chunks) {
    const computed = crc32(input.subarray(chunk.offset + 4, chunk.crcOffset))
    if (computed !== chunk.crc) {
      return pngRejected({
        code: "PNG_CRC_MISMATCH",
        chunkType: chunk.type,
        chunkIndex: chunk.index,
      })
    }
  }

  if (idatStart !== -1) {
    for (let i = idatStart; i <= idatEnd; i++) {
      if (chunks[i]?.type !== "IDAT") {
        return pngRejected({ code: "PNG_IDAT_NOT_CONTIGUOUS", chunkIndex: i })
      }
    }
  }

  if (iendIndex === -1) return pngRejected({ code: "PNG_IEND_NOT_FINAL", chunkIndex: -1 })
  if (iendIndex !== chunks.length - 1) {
    return pngRejected({ code: "PNG_IEND_NOT_FINAL", chunkIndex: iendIndex })
  }
  const iend = chunks[iendIndex]
  if (iend !== undefined && iend.length !== 0) {
    return pngRejected({ code: "PNG_IEND_LENGTH_NONZERO", length: iend.length })
  }

  if (input.byteLength > LIMITS.maxInputBytes) {
    return pngRejected({
      code: "PNG_INPUT_TOO_LARGE",
      actualBytes: input.byteLength,
      limitBytes: LIMITS.maxInputBytes,
    })
  }

  const ihdr = chunks[ihdrIndex]
  if (ihdr !== undefined && ihdr.length !== 13) {
    return pngRejected({ code: "PNG_IHDR_MALFORMED" })
  }
  if (ihdr !== undefined) {
    const width = view.getUint32(ihdr.dataOffset, false)
    const height = view.getUint32(ihdr.dataOffset + 4, false)
    if (
      width === 0 ||
      height === 0 ||
      width > LIMITS.maxImageAxisPixels ||
      height > LIMITS.maxImageAxisPixels
    ) {
      return pngRejected({ code: "PNG_DIMENSIONS_INVALID", width, height })
    }
    const pixels = width * height
    if (!Number.isSafeInteger(pixels) || pixels > LIMITS.maxImagePixels) {
      return pngRejected({
        code: "PNG_PIXEL_LIMIT_EXCEEDED",
        width,
        height,
        limitPixels: LIMITS.maxImagePixels,
      })
    }
  }

  if (apngType !== undefined)
    return pngRejected({ code: "PNG_UNSUPPORTED_APNG", chunkType: apngType })
  if (unknownCritical !== undefined) {
    return pngRejected({ code: "PNG_UNKNOWN_CRITICAL_CHUNK", chunkType: unknownCritical })
  }

  const xmpResult = extractXmp(input, chunks)
  if (xmpResult.kind === "rejected") return xmpResult
  const { xmp, xmpChunkIndex } = xmpResult.value

  const ihdrChunk = chunks[ihdrIndex]
  const width =
    ihdrChunk !== undefined && ihdrChunk.length >= 8
      ? view.getUint32(ihdrChunk.dataOffset, false)
      : 0
  const height =
    ihdrChunk !== undefined && ihdrChunk.length >= 8
      ? view.getUint32(ihdrChunk.dataOffset + 4, false)
      : 0
  const hasCabx = chunks.some((chunk) => chunk.type === "caBX")

  return {
    kind: "ok",
    value: { width, height, chunks, xmp, xmpChunkIndex, hasCabx },
  }
}
