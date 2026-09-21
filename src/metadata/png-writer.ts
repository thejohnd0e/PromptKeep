import { LIMITS } from "../shared/contracts"
import { crc32Chunk } from "./crc32"
import { PNG_SIGNATURE, parsePng } from "./png-parser"
import { type PngChunkDescriptor, type PngResult, pngRejected } from "./png-types"

const XMP_KEYWORD = "XML:com.adobe.xmp"
const PARAMETERS_KEYWORD = "parameters"
const SOURCE_KEYWORD = "Source"
const MODEL_KEYWORD = "Model"
const ITXT_TYPE = new TextEncoder().encode("iTXt")
const TEXT_TYPE = new TextEncoder().encode("tEXt")
const EXIF_TYPE = new TextEncoder().encode("eXIf")

export type PngMetadataPayload = {
  readonly xmpData: Uint8Array
  readonly exifData?: Uint8Array
  readonly parametersText?: string
  readonly sourceUrl?: string
  readonly modelText?: string
}

function buildXmpItxtChunk(xmpData: Uint8Array): Uint8Array {
  const keyword = new TextEncoder().encode(XMP_KEYWORD)
  const dataLength = keyword.byteLength + 5 + xmpData.byteLength
  const chunk = new Uint8Array(12 + dataLength)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, dataLength, false)
  chunk.set(ITXT_TYPE, 4)
  chunk.set(keyword, 8)
  chunk[8 + keyword.byteLength] = 0
  chunk[8 + keyword.byteLength + 1] = 0
  chunk[8 + keyword.byteLength + 2] = 0
  chunk[8 + keyword.byteLength + 3] = 0
  chunk[8 + keyword.byteLength + 4] = 0
  chunk.set(xmpData, 8 + keyword.byteLength + 5)
  view.setUint32(8 + dataLength, crc32Chunk(ITXT_TYPE, chunk.subarray(8, 8 + dataLength)), false)
  return chunk
}

function buildChunk(type: Uint8Array, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.byteLength)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.byteLength, false)
  chunk.set(type, 4)
  chunk.set(data, 8)
  view.setUint32(8 + data.byteLength, crc32Chunk(type, data), false)
  return chunk
}

export function buildParametersText(prompt: string): string {
  return prompt.trim()
}

function buildTextChunk(keyword: string, text: string): Uint8Array {
  const keywordBytes = new TextEncoder().encode(keyword)
  const textBytes = new TextEncoder().encode(text)
  const dataLength = keywordBytes.byteLength + 1 + textBytes.byteLength
  const chunk = new Uint8Array(12 + dataLength)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, dataLength, false)
  chunk.set(TEXT_TYPE, 4)
  chunk.set(keywordBytes, 8)
  chunk[8 + keywordBytes.byteLength] = 0
  chunk.set(textBytes, 8 + keywordBytes.byteLength + 1)
  view.setUint32(8 + dataLength, crc32Chunk(TEXT_TYPE, chunk.subarray(8, 8 + dataLength)), false)
  return chunk
}

/**
 * Builds an iTXt chunk (UTF-8 text). Layout after the chunk header is:
 * keyword, NUL, compression flag, compression method, language tag, NUL,
 * translated keyword, NUL, text. The compression-method byte is mandatory even
 * when the flag is 0, and omitting it makes readers treat the chunk as opaque.
 */
function buildItxtChunk(keyword: string, text: string): Uint8Array {
  const keywordBytes = new TextEncoder().encode(keyword)
  const textBytes = new TextEncoder().encode(text)
  const dataLength = keywordBytes.byteLength + 5 + textBytes.byteLength
  const chunk = new Uint8Array(12 + dataLength)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, dataLength, false)
  chunk.set(ITXT_TYPE, 4)
  chunk.set(keywordBytes, 8)
  const controlOffset = 8 + keywordBytes.byteLength
  chunk.fill(0, controlOffset, controlOffset + 5)
  chunk.set(textBytes, controlOffset + 5)
  view.setUint32(8 + dataLength, crc32Chunk(ITXT_TYPE, chunk.subarray(8, 8 + dataLength)), false)
  return chunk
}

function keywordAt(input: Uint8Array, dataOffset: number, keyword: string): boolean {
  const bytes = new TextEncoder().encode(keyword)
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (input[dataOffset + index] !== bytes[index]) return false
  }
  return true
}

function findTextChunkIndexes(
  chunks: readonly PngChunkDescriptor[],
  input: Uint8Array,
  keyword: string,
): ReadonlySet<number> {
  const indexes = new Set<number>()
  for (const chunk of chunks) {
    if (chunk.type !== "tEXt" && chunk.type !== "iTXt") continue
    if (keywordAt(input, chunk.dataOffset, keyword)) indexes.add(chunk.index)
  }
  return indexes
}

export function insertXmpItxt(input: Uint8Array, xmpData: Uint8Array): PngResult<Uint8Array> {
  return insertPngMetadata(input, { xmpData })
}

export function insertPngMetadata(
  input: Uint8Array,
  metadata: PngMetadataPayload,
): PngResult<Uint8Array> {
  if (metadata.xmpData.byteLength > LIMITS.maxXmpBytes) {
    return pngRejected({
      code: "PNG_XMP_TOO_LARGE",
      actualBytes: metadata.xmpData.byteLength,
      limitBytes: LIMITS.maxXmpBytes,
    })
  }
  const parsed = parsePng(input)
  if (parsed.kind === "rejected") return parsed
  const { chunks, xmpChunkIndex } = parsed.value
  const firstIdat = chunks.find((chunk) => chunk.type === "IDAT")
  if (firstIdat === undefined) return pngRejected({ code: "PNG_IDAT_MISSING" })
  const writesExif = metadata.exifData !== undefined && !parsed.value.hasCabx
  const writesParameters =
    metadata.parametersText !== undefined && metadata.parametersText.length > 0

  const writesSource = metadata.sourceUrl !== undefined && metadata.sourceUrl.trim().length > 0
  const writesModel = metadata.modelText !== undefined && metadata.modelText.trim().length > 0

  // `parameters` is written as iTXt (UTF-8) so non-Latin-1 prompts such as
  // Cyrillic survive exactly. A tEXt copy is deliberately not emitted: its
  // ISO-8859-1 limit would turn the same prompt into mojibake.
  const newChunks = [
    ...(writesExif ? [buildChunk(EXIF_TYPE, metadata.exifData)] : []),
    buildXmpItxtChunk(metadata.xmpData),
    ...(writesParameters ? [buildItxtChunk(PARAMETERS_KEYWORD, metadata.parametersText)] : []),
    ...(writesSource ? [buildTextChunk(SOURCE_KEYWORD, metadata.sourceUrl.trim())] : []),
    ...(writesModel ? [buildTextChunk(MODEL_KEYWORD, metadata.modelText.trim())] : []),
  ]
  const insertedBytes = newChunks.reduce((total, chunk) => total + chunk.byteLength, 0)

  const parametersIndexes = findTextChunkIndexes(chunks, input, PARAMETERS_KEYWORD)
  const sourceIndexes = findTextChunkIndexes(chunks, input, SOURCE_KEYWORD)
  const modelIndexes = findTextChunkIndexes(chunks, input, MODEL_KEYWORD)

  const replaced = (chunk: PngChunkDescriptor): boolean =>
    chunk.index === xmpChunkIndex ||
    (metadata.exifData !== undefined && chunk.type === "eXIf") ||
    (writesParameters && parametersIndexes.has(chunk.index)) ||
    (writesSource && sourceIndexes.has(chunk.index)) ||
    (writesModel && modelIndexes.has(chunk.index))

  let outputLength = PNG_SIGNATURE.byteLength + insertedBytes
  for (const chunk of chunks) {
    if (replaced(chunk)) continue
    outputLength += 12 + chunk.length
  }
  if (outputLength > LIMITS.maxOutputBytes) {
    return pngRejected({
      code: "PNG_OUTPUT_TOO_LARGE",
      actualBytes: outputLength,
      limitBytes: LIMITS.maxOutputBytes,
    })
  }

  const output = new Uint8Array(outputLength)
  output.set(PNG_SIGNATURE, 0)
  let pos = PNG_SIGNATURE.byteLength
  for (const chunk of chunks) {
    if (replaced(chunk)) continue
    if (chunk.index === firstIdat.index) {
      for (const newChunk of newChunks) {
        output.set(newChunk, pos)
        pos += newChunk.byteLength
      }
    }
    const chunkBytes = input.subarray(chunk.offset, chunk.crcOffset + 4)
    output.set(chunkBytes, pos)
    pos += chunkBytes.byteLength
  }
  return { kind: "ok", value: output }
}
