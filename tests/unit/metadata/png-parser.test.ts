import { describe, expect, it } from "vitest"
import { parsePng } from "../../../src/metadata/png-parser"
import { LIMITS } from "../../../src/shared/contracts"
import {
  buildPng,
  buildValidPng,
  compressZlib,
  findChunkCrcOffset,
  makeChunk,
  makeIdat,
  makeIend,
  makeIhdr,
  makeItxt,
  makeXmpItxt,
} from "../../fixtures/png/png-fixtures"

const XMP = new TextEncoder().encode("<x:xmpmeta/>")

function flipByte(input: Uint8Array, index: number): Uint8Array {
  const copy = input.slice()
  copy[index] = (copy[index] ?? 0) ^ 0xff
  return copy
}

describe("Given a valid PNG", () => {
  it("when parsed then it reports the IHDR dimensions", () => {
    const png = buildValidPng({ width: 640, height: 480 })

    const result = parsePng(png)

    expect(result).toEqual({
      kind: "ok",
      value: expect.objectContaining({ width: 640, height: 480 }),
    })
  })

  it("when parsed then it reports the ordered chunk inventory with byte spans", () => {
    const png = buildValidPng({
      ancillary: [
        makeChunk("tEXt", new TextEncoder().encode("a")),
        makeChunk("caBX", new TextEncoder().encode("b")),
      ],
    })

    const result = parsePng(png)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const types = result.value.chunks.map((chunk) => chunk.type)

    expect(types).toEqual(["IHDR", "tEXt", "caBX", "IDAT", "IEND"])
    expect(result.value.chunks[0]?.offset).toBe(8)
    expect(result.value.chunks[0]?.length).toBe(13)
    expect(result.value.chunks[0]?.crcOffset).toBe(8 + 8 + 13)
    expect(result.value.hasCabx).toBe(true)
  })

  it("when parsed then it reports no XMP packet when absent", () => {
    const png = buildValidPng()

    const result = parsePng(png)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.value.xmp).toBeUndefined()
    expect(result.value.xmpChunkIndex).toBeUndefined()
  })
})

describe("Given signature validation", () => {
  it("when the signature is corrupted then it rejects with PNG_INVALID_SIGNATURE", () => {
    const png = buildValidPng()
    png[0] = 0x00

    const result = parsePng(png)

    expect(result).toEqual({ kind: "rejected", error: { code: "PNG_INVALID_SIGNATURE" } })
  })

  it("when the input is shorter than the signature then it rejects with PNG_INVALID_SIGNATURE", () => {
    const result = parsePng(new Uint8Array([0x89, 0x50, 0x4e]))

    expect(result).toEqual({ kind: "rejected", error: { code: "PNG_INVALID_SIGNATURE" } })
  })
})

describe("Given IHDR validation", () => {
  it("when IHDR is missing then it rejects with PNG_IHDR_MISSING", () => {
    const png = buildPng([makeIdat(), makeIend()])

    const result = parsePng(png)

    expect(result).toEqual({ kind: "rejected", error: { code: "PNG_IHDR_MISSING" } })
  })

  it("when IHDR is duplicated then it rejects with PNG_IHDR_DUPLICATE", () => {
    const png = buildPng([makeIhdr(1, 1), makeIhdr(1, 1), makeIdat(), makeIend()])

    const result = parsePng(png)

    expect(result).toEqual({ kind: "rejected", error: { code: "PNG_IHDR_DUPLICATE" } })
  })

  it("when IHDR is not the first chunk then it rejects with PNG_IHDR_NOT_FIRST", () => {
    const png = buildPng([
      makeChunk("tEXt", new Uint8Array(0)),
      makeIhdr(1, 1),
      makeIdat(),
      makeIend(),
    ])

    const result = parsePng(png)

    expect(result).toEqual({ kind: "rejected", error: { code: "PNG_IHDR_NOT_FIRST" } })
  })

  it("when IHDR has a non-13-byte payload then it rejects with PNG_IHDR_MALFORMED", () => {
    const png = buildPng([makeChunk("IHDR", new Uint8Array(12)), makeIdat(), makeIend()])

    const result = parsePng(png)

    expect(result).toEqual({ kind: "rejected", error: { code: "PNG_IHDR_MALFORMED" } })
  })
})

describe("Given chunk length and count validation", () => {
  it("when a chunk length exceeds the input limit then it rejects with PNG_CHUNK_LENGTH_OVERFLOW", () => {
    const overflow = new Uint8Array(12)
    const view = new DataView(overflow.buffer)
    view.setUint32(0, LIMITS.maxInputBytes + 1, false)
    overflow.set(new TextEncoder().encode("tEXt"), 4)
    const png = buildPng([makeIhdr(1, 1), overflow, makeIend()])

    const result = parsePng(png)

    expect(result).toEqual({
      kind: "rejected",
      error: {
        code: "PNG_CHUNK_LENGTH_OVERFLOW",
        chunkIndex: 1,
        length: LIMITS.maxInputBytes + 1,
        limitBytes: LIMITS.maxInputBytes,
      },
    })
  })

  it("when a chunk is truncated then it rejects with PNG_TRUNCATED", () => {
    const png = buildValidPng({
      ancillary: [makeChunk("tEXt", new TextEncoder().encode("0123456789"))],
    })
    const truncated = png.slice(0, png.byteLength - 5)

    const result = parsePng(truncated)

    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.error.code).toBe("PNG_TRUNCATED")
  })

  it("when the chunk count exceeds the limit then it rejects with PNG_TOO_MANY_CHUNKS", () => {
    const filler = Array.from({ length: LIMITS.maxPngChunks - 1 }, () =>
      makeChunk("tEXt", new Uint8Array(0)),
    )
    const png = buildPng([makeIhdr(1, 1), ...filler, makeIend()])

    const result = parsePng(png)

    expect(result).toEqual({
      kind: "rejected",
      error: {
        code: "PNG_TOO_MANY_CHUNKS",
        actualChunks: LIMITS.maxPngChunks,
        limitChunks: LIMITS.maxPngChunks,
      },
    })
  })
})

describe("Given CRC validation", () => {
  it("when any chunk CRC is corrupted then it rejects with PNG_CRC_MISMATCH", () => {
    const png = buildValidPng()
    const crcOffset = findChunkCrcOffset(png, "IHDR")
    expect(crcOffset).toBeGreaterThan(0)

    const result = parsePng(flipByte(png, crcOffset))

    expect(result).toEqual({
      kind: "rejected",
      error: { code: "PNG_CRC_MISMATCH", chunkType: "IHDR", chunkIndex: 0 },
    })
  })
})

describe("Given IDAT and IEND validation", () => {
  it("when another chunk type sits between IDATs then it rejects with PNG_IDAT_NOT_CONTIGUOUS", () => {
    const png = buildPng([
      makeIhdr(1, 1),
      makeIdat(),
      makeChunk("tEXt", new Uint8Array(0)),
      makeIdat(),
      makeIend(),
    ])

    const result = parsePng(png)

    expect(result).toEqual({
      kind: "rejected",
      error: { code: "PNG_IDAT_NOT_CONTIGUOUS", chunkIndex: 2 },
    })
  })

  it("when IEND is not the final chunk then it rejects with PNG_IEND_NOT_FINAL", () => {
    const png = buildPng([
      makeIhdr(1, 1),
      makeIdat(),
      makeIend(),
      makeChunk("tEXt", new Uint8Array(0)),
    ])

    const result = parsePng(png)

    expect(result).toEqual({
      kind: "rejected",
      error: { code: "PNG_IEND_NOT_FINAL", chunkIndex: 2 },
    })
  })

  it("when IEND is missing then it rejects with PNG_IEND_NOT_FINAL", () => {
    const png = buildPng([makeIhdr(1, 1), makeIdat()])

    const result = parsePng(png)

    expect(result).toEqual({
      kind: "rejected",
      error: { code: "PNG_IEND_NOT_FINAL", chunkIndex: -1 },
    })
  })

  it("when IEND has a nonzero length then it rejects with PNG_IEND_LENGTH_NONZERO", () => {
    const png = buildPng([makeIhdr(1, 1), makeIdat(), makeChunk("IEND", new Uint8Array([1, 2, 3]))])

    const result = parsePng(png)

    expect(result).toEqual({
      kind: "rejected",
      error: { code: "PNG_IEND_LENGTH_NONZERO", length: 3 },
    })
  })
})

describe("Given size and dimension limits", () => {
  it("when the input exceeds maxInputBytes then it rejects with PNG_INPUT_TOO_LARGE", () => {
    const idat = makeChunk("IDAT", new Uint8Array(LIMITS.maxInputBytes - 56))
    const png = buildPng([makeIhdr(1, 1), idat, makeIend()])
    expect(png.byteLength).toBe(LIMITS.maxInputBytes + 1)

    const result = parsePng(png)

    expect(result).toEqual({
      kind: "rejected",
      error: {
        code: "PNG_INPUT_TOO_LARGE",
        actualBytes: LIMITS.maxInputBytes + 1,
        limitBytes: LIMITS.maxInputBytes,
      },
    })
  })

  it("when width or height is zero then it rejects with PNG_DIMENSIONS_INVALID", () => {
    const png = buildValidPng({ width: 0, height: 1 })

    const result = parsePng(png)

    expect(result).toEqual({
      kind: "rejected",
      error: { code: "PNG_DIMENSIONS_INVALID", width: 0, height: 1 },
    })
  })

  it("when an axis exceeds maxImageAxisPixels then it rejects with PNG_DIMENSIONS_INVALID", () => {
    const png = buildValidPng({ width: LIMITS.maxImageAxisPixels + 1, height: 1 })

    const result = parsePng(png)

    expect(result).toEqual({
      kind: "rejected",
      error: {
        code: "PNG_DIMENSIONS_INVALID",
        width: LIMITS.maxImageAxisPixels + 1,
        height: 1,
      },
    })
  })

  it("when the pixel count exceeds maxImagePixels then it rejects with PNG_PIXEL_LIMIT_EXCEEDED", () => {
    const png = buildValidPng({
      width: LIMITS.maxImageAxisPixels,
      height: LIMITS.maxImageAxisPixels,
    })

    const result = parsePng(png)

    expect(result).toEqual({
      kind: "rejected",
      error: {
        code: "PNG_PIXEL_LIMIT_EXCEEDED",
        width: LIMITS.maxImageAxisPixels,
        height: LIMITS.maxImageAxisPixels,
        limitPixels: LIMITS.maxImagePixels,
      },
    })
  })
})

describe("Given APNG and unknown critical chunks", () => {
  it.each(["acTL", "fcTL", "fdAT"] as const)(
    "when an APNG %s chunk is present then it rejects with PNG_UNSUPPORTED_APNG",
    (type) => {
      const png = buildValidPng({ ancillary: [makeChunk(type, new Uint8Array(8))] })

      const result = parsePng(png)

      expect(result).toEqual({
        kind: "rejected",
        error: { code: "PNG_UNSUPPORTED_APNG", chunkType: type },
      })
    },
  )

  it("when an unknown critical chunk is present then it rejects with PNG_UNKNOWN_CRITICAL_CHUNK", () => {
    const png = buildValidPng({ ancillary: [makeChunk("PLTE", new Uint8Array(0))] })

    const result = parsePng(png)

    expect(result).toEqual({
      kind: "rejected",
      error: { code: "PNG_UNKNOWN_CRITICAL_CHUNK", chunkType: "PLTE" },
    })
  })

  it("when an unknown ancillary chunk is present then it is accepted and preserved", () => {
    const png = buildValidPng({ ancillary: [makeChunk("prVt", new Uint8Array([1, 2, 3]))] })

    const result = parsePng(png)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.value.chunks.map((chunk) => chunk.type)).toContain("prVt")
  })
})

describe("Given XMP extraction", () => {
  it("when an uncompressed XMP iTXt is present then it locates the packet", () => {
    const png = buildValidPng({ ancillary: [makeXmpItxt(XMP)] })

    const result = parsePng(png)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.value.xmp).toEqual({
      keyword: "XML:com.adobe.xmp",
      language: "",
      translatedKeyword: "",
      data: XMP,
    })
    expect(result.value.xmpChunkIndex).toBe(1)
  })

  it("when a compressed XMP iTXt is present then it decompresses the packet", () => {
    const png = buildValidPng({ ancillary: [makeXmpItxt(XMP, { compressed: true })] })

    const result = parsePng(png)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.value.xmp?.data).toEqual(XMP)
  })

  it("when an XMP iTXt carries language and translated keyword then they are reported", () => {
    const png = buildValidPng({
      ancillary: [makeXmpItxt(XMP, { language: "en", translatedKeyword: "translated" })],
    })

    const result = parsePng(png)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.value.xmp?.language).toBe("en")
    expect(result.value.xmp?.translatedKeyword).toBe("translated")
  })

  it("when two XMP packets are present then it rejects with PNG_XMP_DUPLICATE", () => {
    const png = buildValidPng({ ancillary: [makeXmpItxt(XMP), makeXmpItxt(XMP)] })

    const result = parsePng(png)

    expect(result).toEqual({ kind: "rejected", error: { code: "PNG_XMP_DUPLICATE" } })
  })

  it("when the compression method byte is nonzero then it rejects with PNG_XMP_MALFORMED", () => {
    const keyword = new TextEncoder().encode("XML:com.adobe.xmp")
    const data = new Uint8Array([...keyword, 0, 1, 1, 0, 0, ...XMP])
    const png = buildValidPng({ ancillary: [makeChunk("iTXt", data)] })

    const result = parsePng(png)

    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.error.code).toBe("PNG_XMP_MALFORMED")
  })

  it("when the compression flag is invalid then it rejects with PNG_XMP_MALFORMED", () => {
    const keyword = new TextEncoder().encode("XML:com.adobe.xmp")
    const data = new Uint8Array([...keyword, 0, 2, 0, 0, ...XMP])
    const png = buildValidPng({ ancillary: [makeChunk("iTXt", data)] })

    const result = parsePng(png)

    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.error.code).toBe("PNG_XMP_MALFORMED")
  })

  it("when the compressed text is not a valid zlib stream then it rejects with PNG_XMP_INVALID_ZLIB", () => {
    const keyword = new TextEncoder().encode("XML:com.adobe.xmp")
    const data = new Uint8Array([...keyword, 0, 1, 0, 0, 0, 1, 2, 3, 4])
    const png = buildValidPng({ ancillary: [makeChunk("iTXt", data)] })

    const result = parsePng(png)

    expect(result).toEqual({ kind: "rejected", error: { code: "PNG_XMP_INVALID_ZLIB" } })
  })

  it("when the XMP payload exceeds maxXmpBytes then it rejects with PNG_XMP_TOO_LARGE", () => {
    const png = buildValidPng({ ancillary: [makeXmpItxt(new Uint8Array(LIMITS.maxXmpBytes + 1))] })

    const result = parsePng(png)

    expect(result).toEqual({
      kind: "rejected",
      error: {
        code: "PNG_XMP_TOO_LARGE",
        actualBytes: LIMITS.maxXmpBytes + 1,
        limitBytes: LIMITS.maxXmpBytes,
      },
    })
  })

  it("when a non-XMP iTXt chunk is present then it is ignored", () => {
    const png = buildValidPng({
      ancillary: [makeItxt("Description", new TextEncoder().encode("hello"))],
    })

    const result = parsePng(png)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.value.xmp).toBeUndefined()
  })

  it("when XMP text appears in a tEXt chunk then it is ignored", () => {
    const text = new TextEncoder().encode(`XML:com.adobe.xmp\0${"<x:xmpmeta/>"}`)
    const png = buildValidPng({ ancillary: [makeChunk("tEXt", text)] })

    const result = parsePng(png)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.value.xmp).toBeUndefined()
  })

  it("when a compressed XMP packet decompresses to more than maxXmpBytes then it rejects", () => {
    const large = new Uint8Array(LIMITS.maxXmpBytes + 1)
    const png = buildValidPng({
      ancillary: [makeXmpItxt(large, { compressed: true })],
    })

    const result = parsePng(png)

    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.error.code).toBe("PNG_XMP_TOO_LARGE")
  })

  it("when a compressed XMP packet decompresses to exactly maxXmpBytes then it is accepted", () => {
    const exact = new Uint8Array(LIMITS.maxXmpBytes)
    const png = buildValidPng({
      ancillary: [makeXmpItxt(exact, { compressed: true })],
    })

    const result = parsePng(png)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.value.xmp?.data.byteLength).toBe(LIMITS.maxXmpBytes)
  })

  it("when a compressed XMP packet uses zlib then the decompressed bytes match the source", () => {
    const source = new TextEncoder().encode("compressed xmp payload")
    const png = buildValidPng({
      ancillary: [makeXmpItxt(source, { compressed: true })],
    })

    const result = parsePng(png)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.value.xmp?.data).toEqual(source)
  })

  it("when the compressed payload is produced by compressZlib then it round-trips", () => {
    const source = new TextEncoder().encode("round trip")
    const compressed = compressZlib(source)
    const png = buildValidPng({
      ancillary: [makeItxt("XML:com.adobe.xmp", compressed, { compressed: true })],
    })

    const result = parsePng(png)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.value.xmp?.data).toEqual(source)
  })
})

describe("Given validation order", () => {
  it("when the signature is bad and IHDR is missing then signature wins", () => {
    const png = buildPng([makeIdat(), makeIend()])
    png[0] = 0x00

    const result = parsePng(png)

    expect(result).toEqual({ kind: "rejected", error: { code: "PNG_INVALID_SIGNATURE" } })
  })

  it("when IHDR is missing and a CRC is bad then IHDR wins", () => {
    const png = buildPng([makeIdat(), makeIend()])
    const corrupted = flipByte(png, png.byteLength - 1)

    const result = parsePng(corrupted)

    expect(result).toEqual({ kind: "rejected", error: { code: "PNG_IHDR_MISSING" } })
  })

  it("when a CRC is bad and IDATs are non-contiguous then CRC wins", () => {
    const png = buildPng([
      makeIhdr(1, 1),
      makeIdat(),
      makeChunk("tEXt", new Uint8Array(0)),
      makeIdat(),
      makeIend(),
    ])
    const crcOffset = findChunkCrcOffset(png, "tEXt")
    expect(crcOffset).toBeGreaterThan(0)

    const result = parsePng(flipByte(png, crcOffset))

    expect(result).toEqual({
      kind: "rejected",
      error: { code: "PNG_CRC_MISMATCH", chunkType: "tEXt", chunkIndex: 2 },
    })
  })

  it("when IDATs are non-contiguous and IEND is not final then IDAT contiguity wins", () => {
    const png = buildPng([
      makeIhdr(1, 1),
      makeIdat(),
      makeChunk("tEXt", new Uint8Array(0)),
      makeIdat(),
      makeIend(),
      makeChunk("tEXt", new Uint8Array(0)),
    ])

    const result = parsePng(png)

    expect(result).toEqual({
      kind: "rejected",
      error: { code: "PNG_IDAT_NOT_CONTIGUOUS", chunkIndex: 2 },
    })
  })

  it("when dimensions are invalid and APNG is present then dimensions win", () => {
    const png = buildPng([
      makeIhdr(0, 1),
      makeChunk("acTL", new Uint8Array(8)),
      makeIdat(),
      makeIend(),
    ])

    const result = parsePng(png)

    expect(result).toEqual({
      kind: "rejected",
      error: { code: "PNG_DIMENSIONS_INVALID", width: 0, height: 1 },
    })
  })

  it("when APNG is present and an unknown critical chunk exists then APNG wins", () => {
    const png = buildPng([
      makeIhdr(1, 1),
      makeChunk("acTL", new Uint8Array(8)),
      makeChunk("PLTE", new Uint8Array(0)),
      makeIdat(),
      makeIend(),
    ])

    const result = parsePng(png)

    expect(result).toEqual({
      kind: "rejected",
      error: { code: "PNG_UNSUPPORTED_APNG", chunkType: "acTL" },
    })
  })
})
