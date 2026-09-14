import { describe, expect, it } from "vitest"
import { parsePng } from "../../../src/metadata/png-parser"
import {
  buildParametersText,
  insertPngMetadata,
  insertXmpItxt,
} from "../../../src/metadata/png-writer"
import { LIMITS } from "../../../src/shared/contracts"
import {
  buildPng,
  buildValidPng,
  findChunkCrcOffset,
  makeChunk,
  makeIend,
  makeIhdr,
  makeXmpItxt,
} from "../../fixtures/png/png-fixtures"

const XMP = new TextEncoder().encode("<x:xmpmeta/>")

function chunkTypes(png: Uint8Array): string[] {
  const result = parsePng(png)
  expect(result.kind).toBe("ok")
  if (result.kind !== "ok") return []
  return result.value.chunks.map((chunk) => chunk.type)
}

describe("Given insertXmpItxt", () => {
  it("when inserting into a valid PNG then it returns a byte-preserving PNG with one XMP packet before the first IDAT", () => {
    const input = buildValidPng({
      ancillary: [makeChunk("tEXt", new TextEncoder().encode("keep"))],
    })

    const result = insertXmpItxt(input, XMP)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const output = result.value
    expect(chunkTypes(output)).toEqual(["IHDR", "tEXt", "iTXt", "IDAT", "IEND"])
    const parsed = parsePng(output)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return
    expect(parsed.value.xmp?.data).toEqual(XMP)
    expect(parsed.value.xmpChunkIndex).toBe(2)
  })

  it("when inserting uncompressed XMP then the iTXt control fields follow the PNG specification", () => {
    const result = insertXmpItxt(buildValidPng(), XMP)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const parsed = parsePng(result.value)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return
    const chunk = parsed.value.chunks.find((candidate) => candidate.type === "iTXt")
    expect(chunk).toBeDefined()
    if (chunk === undefined) return
    const data = result.value.subarray(chunk.dataOffset, chunk.crcOffset)
    const keywordEnd = data.indexOf(0)
    expect(data.slice(keywordEnd, keywordEnd + 5)).toEqual(new Uint8Array(5))
    expect(data.slice(keywordEnd + 5)).toEqual(XMP)
  })

  it("when parametersText contains Cyrillic then an iTXt copy preserves it in UTF-8", () => {
    const prompt = "Красная лиса в снегу"
    const result = insertPngMetadata(buildValidPng(), {
      xmpData: XMP,
      parametersText: prompt,
    })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const parsed = parsePng(result.value)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return
    const itxt = parsed.value.chunks.find(
      (candidate) => candidate.type === "iTXt" && result.value[candidate.dataOffset] === 0x70,
    )
    expect(itxt).toBeDefined()
    if (itxt === undefined) return
    const data = result.value.subarray(itxt.dataOffset, itxt.crcOffset)
    const keywordEnd = data.indexOf(0)
    expect(Buffer.from(data.subarray(0, keywordEnd)).toString("utf8")).toBe("parameters")
    expect(data.slice(keywordEnd, keywordEnd + 5)).toEqual(new Uint8Array(5))
    expect(Buffer.from(data.subarray(keywordEnd + 5)).toString("utf8")).toBe(prompt)
  })

  it("when building parameters text then it contains only the prompt", () => {
    expect(buildParametersText("a cat sitting on a table")).toBe("a cat sitting on a table")
  })

  it("when inserting then all non-XMP chunks are copied byte-for-byte with their original CRCs", () => {
    const ancillary = makeChunk("caBX", new TextEncoder().encode("payload"))
    const input = buildValidPng({ ancillary: [ancillary] })

    const result = insertXmpItxt(input, XMP)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const output = result.value
    const caBxOffset = findChunkCrcOffset(output, "caBX")
    const inputCaBxOffset = findChunkCrcOffset(input, "caBX")
    expect(caBxOffset).toBeGreaterThan(0)
    expect(inputCaBxOffset).toBeGreaterThan(0)
    const caBxChunk = output.subarray(caBxOffset - 8 - ancillary.byteLength + 8, caBxOffset + 4)
    const inputCaBxChunk = input.subarray(
      inputCaBxOffset - 8 - ancillary.byteLength + 8,
      inputCaBxOffset + 4,
    )
    expect(caBxChunk).toEqual(inputCaBxChunk)
  })

  it("when inserting metadata beside caBX then it omits eXIf to avoid ExifTool directory collisions", () => {
    const input = buildValidPng({
      ancillary: [makeChunk("caBX", new TextEncoder().encode("c2pa"))],
    })

    const result = insertPngMetadata(input, { xmpData: XMP, exifData: new Uint8Array([1]) })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(chunkTypes(result.value)).toEqual(["IHDR", "caBX", "iTXt", "IDAT", "IEND"])
  })

  it("when inserting then the output re-parses as a valid PNG", () => {
    const input = buildValidPng()

    const result = insertXmpItxt(input, XMP)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(parsePng(result.value).kind).toBe("ok")
  })

  it("when inserting twice with the same input then the outputs are identical", () => {
    const input = buildValidPng()

    const first = insertXmpItxt(input, XMP)
    const second = insertXmpItxt(input, XMP)

    expect(first.kind).toBe("ok")
    expect(second.kind).toBe("ok")
    if (first.kind !== "ok" || second.kind !== "ok") return
    expect(first.value).toEqual(second.value)
  })

  it("when the input already has an XMP packet then it is replaced, not duplicated", () => {
    const oldXmp = new TextEncoder().encode("<x:xmpmeta>old</x:xmpmeta>")
    const input = buildValidPng({ ancillary: [makeXmpItxt(oldXmp)] })

    const result = insertXmpItxt(input, XMP)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const output = result.value
    expect(chunkTypes(output).filter((type) => type === "iTXt")).toEqual(["iTXt"])
    const parsed = parsePng(output)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return
    expect(parsed.value.xmp?.data).toEqual(XMP)
  })

  it("when the input has a compressed XMP packet then it is replaced with an uncompressed one", () => {
    const input = buildValidPng({ ancillary: [makeXmpItxt(XMP, { compressed: true })] })

    const result = insertXmpItxt(input, XMP)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const parsed = parsePng(result.value)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return
    expect(parsed.value.xmp?.data).toEqual(XMP)
  })

  it("when the input has no IDAT then it rejects with PNG_IDAT_MISSING", () => {
    const input = buildPng([makeIhdr(1, 1), makeIend()])

    const result = insertXmpItxt(input, XMP)

    expect(result).toEqual({ kind: "rejected", error: { code: "PNG_IDAT_MISSING" } })
  })

  it("when the XMP payload exceeds maxXmpBytes then it rejects with PNG_XMP_TOO_LARGE", () => {
    const input = buildValidPng()

    const result = insertXmpItxt(input, new Uint8Array(LIMITS.maxXmpBytes + 1))

    expect(result).toEqual({
      kind: "rejected",
      error: {
        code: "PNG_XMP_TOO_LARGE",
        actualBytes: LIMITS.maxXmpBytes + 1,
        limitBytes: LIMITS.maxXmpBytes,
      },
    })
  })

  it("when the XMP payload is exactly maxXmpBytes then it is accepted", () => {
    const input = buildValidPng()

    const result = insertXmpItxt(input, new Uint8Array(LIMITS.maxXmpBytes))

    expect(result.kind).toBe("ok")
  })

  it("when the output would exceed maxOutputBytes then it rejects with PNG_OUTPUT_TOO_LARGE", () => {
    const idat = makeChunk("IDAT", new Uint8Array(LIMITS.maxInputBytes - 89))
    const input = buildPng([makeIhdr(1, 1), idat, makeIend()])
    expect(input.byteLength).toBe(LIMITS.maxInputBytes - 32)

    const result = insertXmpItxt(input, new Uint8Array(1))

    expect(result).toEqual({
      kind: "rejected",
      error: {
        code: "PNG_OUTPUT_TOO_LARGE",
        actualBytes: LIMITS.maxOutputBytes + 3,
        limitBytes: LIMITS.maxOutputBytes,
      },
    })
  })

  it("when the output fits within maxOutputBytes then it is accepted", () => {
    const idat = makeChunk("IDAT", new Uint8Array(LIMITS.maxInputBytes - 189))
    const input = buildPng([makeIhdr(1, 1), idat, makeIend()])
    expect(input.byteLength).toBe(LIMITS.maxInputBytes - 132)

    const result = insertXmpItxt(input, new Uint8Array(1))

    expect(result.kind).toBe("ok")
  })

  it("when the input is not a valid PNG then it rejects with the parser error", () => {
    const input = new Uint8Array([0x00, 0x50, 0x4e, 0x47])

    const result = insertXmpItxt(input, XMP)

    expect(result).toEqual({ kind: "rejected", error: { code: "PNG_INVALID_SIGNATURE" } })
  })

  it("when inserting with parametersText then it writes an iTXt parameters chunk before IDAT", () => {
    const params = buildParametersText("a cat sitting on a table")
    const result = insertPngMetadata(buildValidPng(), {
      xmpData: XMP,
      parametersText: params,
    })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const parsed = parsePng(result.value)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return
    const paramsChunk = parsed.value.chunks.find(
      (c) => c.type === "iTXt" && result.value[c.dataOffset] === 0x70,
    )
    expect(paramsChunk).toBeDefined()
    if (paramsChunk === undefined) return
    const data = result.value.subarray(paramsChunk.dataOffset, paramsChunk.crcOffset)
    const keywordEnd = data.indexOf(0)
    expect(Buffer.from(data.subarray(0, keywordEnd)).toString("utf8")).toBe("parameters")
    expect(data.slice(keywordEnd, keywordEnd + 5)).toEqual(new Uint8Array(5))
    expect(Buffer.from(data.subarray(keywordEnd + 5)).toString("utf8")).toBe(
      "a cat sitting on a table",
    )
    const firstIdat = parsed.value.chunks.find((c) => c.type === "IDAT")
    expect(firstIdat).toBeDefined()
    if (firstIdat !== undefined) expect(paramsChunk.index).toBeLessThan(firstIdat.index)
  })

  it("when parametersText is written then no tEXt parameters copy is emitted", () => {
    const result = insertPngMetadata(buildValidPng(), {
      xmpData: XMP,
      parametersText: buildParametersText("Красная лиса в снегу"),
    })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const parsed = parsePng(result.value)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return
    const textCopies = parsed.value.chunks.filter(
      (candidate) =>
        candidate.type === "tEXt" &&
        result.value[candidate.dataOffset] === 0x70 &&
        result.value[candidate.dataOffset + 1] === 0x61,
    )
    expect(textCopies).toHaveLength(0)
  })

  it("when sourceUrl is provided then it writes a Source tEXt chunk before IDAT", () => {
    const url = "https://chatgpt.com/g/g-p-abc/c/def-123"
    const result = insertPngMetadata(buildValidPng(), { xmpData: XMP, sourceUrl: url })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const parsed = parsePng(result.value)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return
    const sourceChunk = parsed.value.chunks.find((c) => c.type === "tEXt")
    expect(sourceChunk).toBeDefined()
    if (sourceChunk === undefined) return
    const data = result.value.subarray(sourceChunk.dataOffset, sourceChunk.crcOffset)
    const keywordEnd = data.indexOf(0)
    expect(Buffer.from(data.subarray(0, keywordEnd)).toString("utf8")).toBe("Source")
    expect(Buffer.from(data.subarray(keywordEnd + 1)).toString("utf8")).toBe(url)
    const firstIdat = parsed.value.chunks.find((c) => c.type === "IDAT")
    expect(firstIdat).toBeDefined()
    if (firstIdat !== undefined) expect(sourceChunk.index).toBeLessThan(firstIdat.index)
  })

  it("when sourceUrl is absent then no Source chunk is written", () => {
    const result = insertPngMetadata(buildValidPng(), { xmpData: XMP })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const parsed = parsePng(result.value)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return
    const hasSource = parsed.value.chunks.some(
      (c) =>
        c.type === "tEXt" &&
        result.value[c.dataOffset] === 0x53 &&
        result.value[c.dataOffset + 1] === 0x6f,
    )
    expect(hasSource).toBe(false)
  })

  it("when parametersText is absent then no parameters chunk is written", () => {
    const result = insertPngMetadata(buildValidPng(), { xmpData: XMP })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const parsed = parsePng(result.value)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return
    const hasParams = parsed.value.chunks.some(
      (c) =>
        (c.type === "tEXt" || c.type === "iTXt") &&
        result.value[c.dataOffset] === 0x70 &&
        result.value[c.dataOffset + 1] === 0x61 &&
        result.value[c.dataOffset + 2] === 0x72,
    )
    expect(hasParams).toBe(false)
  })
})
