import { LIMITS } from "../shared/contracts"
import { crc32Chunk } from "./crc32"
import { PNG_SIGNATURE, parsePng } from "./png-parser"
import { type PngResult, pngRejected } from "./png-types"

const XMP_KEYWORD = "XML:com.adobe.xmp"
const ITXT_TYPE = new TextEncoder().encode("iTXt")

function buildXmpItxtChunk(xmpData: Uint8Array): Uint8Array {
  const keyword = new TextEncoder().encode(XMP_KEYWORD)
  const dataLength = keyword.byteLength + 4 + xmpData.byteLength
  const chunk = new Uint8Array(12 + dataLength)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, dataLength, false)
  chunk.set(ITXT_TYPE, 4)
  chunk.set(keyword, 8)
  chunk[8 + keyword.byteLength] = 0
  chunk[8 + keyword.byteLength + 1] = 0
  chunk[8 + keyword.byteLength + 2] = 0
  chunk[8 + keyword.byteLength + 3] = 0
  chunk.set(xmpData, 8 + keyword.byteLength + 4)
  view.setUint32(8 + dataLength, crc32Chunk(ITXT_TYPE, chunk.subarray(8, 8 + dataLength)), false)
  return chunk
}

export function insertXmpItxt(input: Uint8Array, xmpData: Uint8Array): PngResult<Uint8Array> {
  if (xmpData.byteLength > LIMITS.maxXmpBytes) {
    return pngRejected({
      code: "PNG_XMP_TOO_LARGE",
      actualBytes: xmpData.byteLength,
      limitBytes: LIMITS.maxXmpBytes,
    })
  }
  const parsed = parsePng(input)
  if (parsed.kind === "rejected") return parsed
  const { chunks, xmpChunkIndex } = parsed.value
  const firstIdat = chunks.find((chunk) => chunk.type === "IDAT")
  if (firstIdat === undefined) return pngRejected({ code: "PNG_IDAT_MISSING" })

  const newChunk = buildXmpItxtChunk(xmpData)
  let outputLength = PNG_SIGNATURE.byteLength + newChunk.byteLength
  for (const chunk of chunks) {
    if (chunk.index === xmpChunkIndex) continue
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
    if (chunk.index === xmpChunkIndex) continue
    if (chunk.index === firstIdat.index) {
      output.set(newChunk, pos)
      pos += newChunk.byteLength
    }
    const chunkBytes = input.subarray(chunk.offset, chunk.crcOffset + 4)
    output.set(chunkBytes, pos)
    pos += chunkBytes.byteLength
  }
  return { kind: "ok", value: output }
}
