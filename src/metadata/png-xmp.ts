import { inflateSync } from "node:zlib"
import { LIMITS } from "../shared/contracts"
import {
  type PngChunkDescriptor,
  type PngResult,
  type PngXmpPacket,
  pngRejected,
} from "./png-types"

export const XMP_KEYWORD = "XML:com.adobe.xmp"

function findNull(bytes: Uint8Array, start: number, end: number): number {
  for (let i = start; i < end; i++) {
    if (bytes[i] === 0) return i
  }
  return -1
}

function decodeCstr(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end))
}

function parseItxtXmp(input: Uint8Array, chunk: PngChunkDescriptor): PngResult<PngXmpPacket> {
  const dEnd = chunk.dataOffset + chunk.length
  const kwEnd = findNull(input, chunk.dataOffset, dEnd)
  if (kwEnd === -1)
    return pngRejected({ code: "PNG_XMP_MALFORMED", reason: "keyword_not_terminated" })
  let pos = kwEnd + 1
  if (pos >= dEnd)
    return pngRejected({ code: "PNG_XMP_MALFORMED", reason: "missing_compression_flag" })
  const flag = input[pos] ?? 0
  pos += 1
  if (flag !== 0 && flag !== 1) {
    return pngRejected({
      code: "PNG_XMP_MALFORMED",
      reason: `invalid_compression_flag_${String(flag)}`,
    })
  }
  if (flag === 1) {
    if (pos >= dEnd)
      return pngRejected({ code: "PNG_XMP_MALFORMED", reason: "missing_compression_method" })
    const method = input[pos] ?? 0
    pos += 1
    if (method !== 0) {
      return pngRejected({
        code: "PNG_XMP_MALFORMED",
        reason: `invalid_compression_method_${String(method)}`,
      })
    }
  }
  const langEnd = findNull(input, pos, dEnd)
  if (langEnd === -1)
    return pngRejected({ code: "PNG_XMP_MALFORMED", reason: "language_not_terminated" })
  const language = decodeCstr(input, pos, langEnd)
  pos = langEnd + 1
  const trnEnd = findNull(input, pos, dEnd)
  if (trnEnd === -1)
    return pngRejected({ code: "PNG_XMP_MALFORMED", reason: "translated_not_terminated" })
  const translatedKeyword = decodeCstr(input, pos, trnEnd)
  pos = trnEnd + 1
  let data = input.subarray(pos, dEnd)
  if (flag === 1) {
    try {
      data = new Uint8Array(inflateSync(data, { maxOutputLength: LIMITS.maxXmpBytes + 1 }))
    } catch {
      return pngRejected({ code: "PNG_XMP_INVALID_ZLIB" })
    }
  }
  if (data.byteLength > LIMITS.maxXmpBytes) {
    return pngRejected({
      code: "PNG_XMP_TOO_LARGE",
      actualBytes: data.byteLength,
      limitBytes: LIMITS.maxXmpBytes,
    })
  }
  return {
    kind: "ok",
    value: { keyword: XMP_KEYWORD, language, translatedKeyword, data },
  }
}

export function extractXmp(
  input: Uint8Array,
  chunks: readonly PngChunkDescriptor[],
): PngResult<{
  readonly xmp: PngXmpPacket | undefined
  readonly xmpChunkIndex: number | undefined
}> {
  let xmp: PngXmpPacket | undefined
  let xmpChunkIndex: number | undefined
  for (const chunk of chunks) {
    if (chunk.type !== "iTXt") continue
    const kwEnd = findNull(input, chunk.dataOffset, chunk.dataOffset + chunk.length)
    if (kwEnd === -1) continue
    const kw = decodeCstr(input, chunk.dataOffset, kwEnd)
    if (kw !== XMP_KEYWORD) continue
    if (xmp !== undefined) return pngRejected({ code: "PNG_XMP_DUPLICATE" })
    const packet = parseItxtXmp(input, chunk)
    if (packet.kind === "rejected") return packet
    xmp = packet.value
    xmpChunkIndex = chunk.index
  }
  return { kind: "ok", value: { xmp, xmpChunkIndex } }
}
