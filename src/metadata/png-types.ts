export type PngFailure =
  | { readonly code: "PNG_INVALID_SIGNATURE" }
  | { readonly code: "PNG_IHDR_MISSING" }
  | { readonly code: "PNG_IHDR_DUPLICATE" }
  | { readonly code: "PNG_IHDR_NOT_FIRST" }
  | { readonly code: "PNG_IHDR_MALFORMED" }
  | {
      readonly code: "PNG_CHUNK_LENGTH_OVERFLOW"
      readonly chunkIndex: number
      readonly length: number
      readonly limitBytes: number
    }
  | {
      readonly code: "PNG_TRUNCATED"
      readonly chunkIndex: number
      readonly expectedBytes: number
      readonly actualBytes: number
    }
  | {
      readonly code: "PNG_TOO_MANY_CHUNKS"
      readonly actualChunks: number
      readonly limitChunks: number
    }
  | { readonly code: "PNG_CRC_MISMATCH"; readonly chunkType: string; readonly chunkIndex: number }
  | { readonly code: "PNG_IDAT_NOT_CONTIGUOUS"; readonly chunkIndex: number }
  | { readonly code: "PNG_IDAT_MISSING" }
  | { readonly code: "PNG_IEND_NOT_FINAL"; readonly chunkIndex: number }
  | { readonly code: "PNG_IEND_LENGTH_NONZERO"; readonly length: number }
  | {
      readonly code: "PNG_INPUT_TOO_LARGE"
      readonly actualBytes: number
      readonly limitBytes: number
    }
  | { readonly code: "PNG_DIMENSIONS_INVALID"; readonly width: number; readonly height: number }
  | {
      readonly code: "PNG_PIXEL_LIMIT_EXCEEDED"
      readonly width: number
      readonly height: number
      readonly limitPixels: number
    }
  | { readonly code: "PNG_UNSUPPORTED_APNG"; readonly chunkType: string }
  | { readonly code: "PNG_UNKNOWN_CRITICAL_CHUNK"; readonly chunkType: string }
  | { readonly code: "PNG_XMP_DUPLICATE" }
  | { readonly code: "PNG_XMP_MALFORMED"; readonly reason: string }
  | { readonly code: "PNG_XMP_INVALID_ZLIB" }
  | {
      readonly code: "PNG_XMP_TOO_LARGE"
      readonly actualBytes: number
      readonly limitBytes: number
    }
  | {
      readonly code: "PNG_OUTPUT_TOO_LARGE"
      readonly actualBytes: number
      readonly limitBytes: number
    }

export type PngResult<Value> =
  | { readonly kind: "ok"; readonly value: Value }
  | { readonly kind: "rejected"; readonly error: PngFailure }

export function pngRejected<Value>(error: PngFailure): PngResult<Value> {
  return { kind: "rejected", error }
}

export type PngChunkDescriptor = {
  readonly type: string
  readonly index: number
  readonly offset: number
  readonly length: number
  readonly dataOffset: number
  readonly crcOffset: number
  readonly crc: number
}

export type PngXmpPacket = {
  readonly keyword: string
  readonly language: string
  readonly translatedKeyword: string
  readonly data: Uint8Array
}

export type PngParseResult = {
  readonly width: number
  readonly height: number
  readonly chunks: readonly PngChunkDescriptor[]
  readonly xmp: PngXmpPacket | undefined
  readonly xmpChunkIndex: number | undefined
  readonly hasCabx: boolean
}
