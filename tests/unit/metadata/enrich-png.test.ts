import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { enrichPng } from "../../../src/metadata/enrich-png"
import { CONTROLLED_DIGITAL_SOURCE_TYPE, readIptcAiXmp } from "../../../src/metadata/iptc-ai"
import { parsePng } from "../../../src/metadata/png-parser"
import { LIMITS } from "../../../src/shared/contracts"
import {
  buildPng,
  buildValidPng,
  makeChunk,
  makeIend,
  makeIhdr,
  makeXmpItxt,
  PNG_SIGNATURE,
} from "../../fixtures/png/png-fixtures"

const PROMPT = "a serene mountain lake at dawn"

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

describe("Given enrichPng", () => {
  it("when enriching then the source bytes are not mutated", () => {
    const input = buildValidPng({
      ancillary: [makeChunk("tEXt", new TextEncoder().encode("keep"))],
    })
    const before = input.slice()

    const result = enrichPng(input, { provider: "chatgpt", originalPrompt: PROMPT })

    expect(result.kind).toBe("ok")
    expect(input).toEqual(before)
  })

  it("when enriching a caBX-free PNG then the metadata summary maps fields exactly", () => {
    const input = buildValidPng()

    const result = enrichPng(input, {
      provider: "chatgpt",
      originalPrompt: PROMPT,
      observedVersion: "GPT-5",
    })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.value.metadata).toEqual({
      prompt: PROMPT,
      system: "ChatGPT",
      systemVersion: "GPT-5",
      digitalSourceType: CONTROLLED_DIGITAL_SOURCE_TYPE,
    })
    expect(result.value.c2paStatus).toBe("absent")
    expect(result.value.sourceSha256).toBe(sha256Hex(input))
    expect(result.value.outputSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(result.value.outputSha256).not.toBe(result.value.sourceSha256)
  })

  it.each([
    ["chatgpt", "ChatGPT"],
    ["gemini", "Google Gemini"],
    ["grok", "Grok"],
  ] as const)("when the provider is %s then the system label is %s", (provider, system) => {
    const result = enrichPng(buildValidPng(), { provider, originalPrompt: PROMPT })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.value.metadata.system).toBe(system)
  })

  it("when no observed version is provided then the summary omits systemVersion", () => {
    const result = enrichPng(buildValidPng(), { provider: "gemini", originalPrompt: PROMPT })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.value.metadata).not.toHaveProperty("systemVersion")
  })

  it("when the source has caBX and no acknowledgement then it rejects with C2PA_ACK_REQUIRED, no output, and the source hash unchanged", () => {
    const input = buildValidPng({
      ancillary: [makeChunk("caBX", new TextEncoder().encode("c2pa"))],
    })

    const result = enrichPng(input, { provider: "chatgpt", originalPrompt: PROMPT })

    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.error.code).toBe("C2PA_ACK_REQUIRED")
    if (result.error.code !== "C2PA_ACK_REQUIRED") return
    expect(result.error.sourceSha256).toBe(sha256Hex(input))
    expect("outputBytes" in result).toBe(false)
  })

  it("when the source has caBX and acknowledgement is given then it writes and reports present-unverified-after-modification", () => {
    const input = buildValidPng({
      ancillary: [makeChunk("caBX", new TextEncoder().encode("c2pa"))],
    })

    const result = enrichPng(
      input,
      { provider: "chatgpt", originalPrompt: PROMPT },
      { acknowledgeCaBX: true },
    )

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.value.c2paStatus).toBe("present-unverified-after-modification")
    const parsed = parsePng(result.value.outputBytes)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return
    expect(parsed.value.hasCabx).toBe(true)
  })

  it("when enriching then the output re-parses as a valid PNG with the exact XMP values", () => {
    const input = buildValidPng({
      ancillary: [makeChunk("tEXt", new TextEncoder().encode("keep"))],
    })

    const result = enrichPng(input, {
      provider: "grok",
      originalPrompt: PROMPT,
      observedVersion: "3",
    })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const parsed = parsePng(result.value.outputBytes)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return
    const xmp = parsed.value.xmp?.data
    expect(xmp).toBeDefined()
    if (xmp === undefined) return
    expect(readIptcAiXmp(xmp)).toEqual({
      kind: "ok",
      value: {
        prompt: PROMPT,
        system: "Grok",
        systemVersion: "3",
        digitalSourceType: CONTROLLED_DIGITAL_SOURCE_TYPE,
      },
    })
  })

  it("when enriching then it writes a UTF-8 iTXt parameters chunk", () => {
    const result = enrichPng(buildValidPng(), {
      provider: "chatgpt",
      originalPrompt: PROMPT,
    })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const parsed = parsePng(result.value.outputBytes)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return
    const paramsChunk = parsed.value.chunks.find(
      (c) => c.type === "iTXt" && result.value.outputBytes[c.dataOffset] === 0x70,
    )
    expect(paramsChunk).toBeDefined()
    if (paramsChunk === undefined) return
    const data = result.value.outputBytes.subarray(paramsChunk.dataOffset, paramsChunk.crcOffset)
    const keywordEnd = data.indexOf(0)
    expect(Buffer.from(data.subarray(0, keywordEnd)).toString("utf8")).toBe("parameters")
    expect(Buffer.from(data.subarray(keywordEnd + 5)).toString("utf8")).toBe(PROMPT)
  })

  it("when enriching a Cyrillic prompt then the parameters chunk keeps it intact", () => {
    const cyrillic = "Красная лиса в снегу"

    const result = enrichPng(buildValidPng(), {
      provider: "chatgpt",
      originalPrompt: cyrillic,
    })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const parsed = parsePng(result.value.outputBytes)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return
    const paramsChunk = parsed.value.chunks.find(
      (c) => c.type === "iTXt" && result.value.outputBytes[c.dataOffset] === 0x70,
    )
    expect(paramsChunk).toBeDefined()
    if (paramsChunk === undefined) return
    const data = result.value.outputBytes.subarray(paramsChunk.dataOffset, paramsChunk.crcOffset)
    const keywordEnd = data.indexOf(0)
    expect(Buffer.from(data.subarray(keywordEnd + 5)).toString("utf8")).toBe(cyrillic)
  })

  it("when enriching with a source URL then the Source tEXt chunk carries it", () => {
    const url = "https://chatgpt.com/g/g-p-abc/c/def-123"

    const result = enrichPng(buildValidPng(), {
      provider: "chatgpt",
      originalPrompt: PROMPT,
      sourceUrl: url,
    })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const parsed = parsePng(result.value.outputBytes)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return
    const textChunks = parsed.value.chunks.filter((chunk) => chunk.type === "tEXt")
    const texts = textChunks.map((chunk) => {
      const data = result.value.outputBytes.subarray(chunk.dataOffset, chunk.crcOffset)
      const keywordEnd = data.indexOf(0)
      return {
        keyword: Buffer.from(data.subarray(0, keywordEnd)).toString("utf8"),
        text: Buffer.from(data.subarray(keywordEnd + 1)).toString("utf8"),
      }
    })
    const source = texts.find((entry) => entry.keyword === "Source")
    expect(source?.text).toBe(url)
    expect(texts.some((entry) => entry.keyword === "parameters")).toBe(false)
  })

  it("when enriching then it writes a pre-IDAT Exif profile with ASCII and Unicode prompt data", () => {
    const unicodePrompt = "Красная лиса in the snow"

    const result = enrichPng(buildValidPng(), {
      provider: "chatgpt",
      originalPrompt: unicodePrompt,
    })

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const parsed = parsePng(result.value.outputBytes)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return
    const exif = parsed.value.chunks.find((chunk) => chunk.type === "eXIf")
    const firstIdat = parsed.value.chunks.find((chunk) => chunk.type === "IDAT")
    expect(exif).toBeDefined()
    expect(firstIdat).toBeDefined()
    if (exif === undefined || firstIdat === undefined) return
    expect(exif.index).toBeLessThan(firstIdat.index)
    const profile = result.value.outputBytes.subarray(exif.dataOffset, exif.crcOffset)
    expect(profile.slice(0, 8)).toEqual(
      new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
    )
    expect(Buffer.from(profile).includes(Buffer.from("ChatGPT\0", "ascii"))).toBe(true)
    expect(Buffer.from(profile).includes(Buffer.from(unicodePrompt, "utf16le"))).toBe(true)
  })
})

describe("Given error classes", () => {
  it("when the provider is unsupported then it rejects with unsupported_provider", () => {
    const result = enrichPng(buildValidPng(), {
      provider: "unknown" as never,
      originalPrompt: PROMPT,
    })

    expect(result).toEqual({
      kind: "rejected",
      error: { code: "unsupported_provider", provider: "unknown" },
    })
  })

  it("when the prompt is empty then it rejects with prompt_missing", () => {
    const result = enrichPng(buildValidPng(), { provider: "chatgpt", originalPrompt: "   " })

    expect(result).toEqual({
      kind: "rejected",
      error: { code: "prompt_missing", provider: "chatgpt" },
    })
  })

  it("when the prompt exceeds maxPromptUtf8Bytes then it rejects with prompt_too_large", () => {
    const result = enrichPng(buildValidPng(), {
      provider: "chatgpt",
      originalPrompt: "a".repeat(LIMITS.maxPromptUtf8Bytes + 1),
    })

    expect(result).toEqual({
      kind: "rejected",
      error: {
        code: "prompt_too_large",
        actualBytes: LIMITS.maxPromptUtf8Bytes + 1,
        limitBytes: LIMITS.maxPromptUtf8Bytes,
      },
    })
  })

  it("when the prompt contains XML-forbidden text then it rejects with xmp_invalid_value", () => {
    const result = enrichPng(buildValidPng(), {
      provider: "chatgpt",
      originalPrompt: "bad\0prompt",
    })

    expect(result).toEqual({
      kind: "rejected",
      error: { code: "xmp_invalid_value", field: "prompt" },
    })
  })

  it("when the source is not a PNG then it rejects with unsupported_media_type", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

    const result = enrichPng(jpeg, { provider: "chatgpt", originalPrompt: PROMPT })

    expect(result).toEqual({
      kind: "rejected",
      error: { code: "unsupported_media_type", mediaType: "image/jpeg" },
    })
  })

  it("when the source exceeds maxInputBytes then it rejects with input_too_large", () => {
    const oversized = new Uint8Array(LIMITS.maxInputBytes + 1)
    oversized.set(PNG_SIGNATURE, 0)

    const result = enrichPng(oversized, { provider: "chatgpt", originalPrompt: PROMPT })

    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.error.code).toBe("input_too_large")
    expect("outputBytes" in result).toBe(false)
  })

  it("when the output would exceed maxOutputBytes then it rejects with output_too_large", () => {
    const idat = makeChunk("IDAT", new Uint8Array(LIMITS.maxInputBytes - 89))
    const input = buildPng([makeIhdr(1, 1), idat, makeIend()])

    const result = enrichPng(input, { provider: "chatgpt", originalPrompt: PROMPT })

    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.error.code).toBe("output_too_large")
    expect("outputBytes" in result).toBe(false)
  })

  it("when the PNG has a bad CRC then it rejects with invalid_png", () => {
    const input = buildValidPng()
    const lastByte = input[input.byteLength - 1] ?? 0
    input[input.byteLength - 1] = lastByte ^ 0xff

    const result = enrichPng(input, { provider: "chatgpt", originalPrompt: PROMPT })

    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.error.code).toBe("invalid_png")
    expect("outputBytes" in result).toBe(false)
  })

  it("when the PNG is an APNG then it rejects with unsupported_png", () => {
    const input = buildValidPng({ ancillary: [makeChunk("acTL", new Uint8Array(8))] })

    const result = enrichPng(input, { provider: "chatgpt", originalPrompt: PROMPT })

    expect(result).toEqual({
      kind: "rejected",
      error: { code: "unsupported_png", feature: "APNG" },
    })
  })

  it("when the embedded XMP is hostile then it rejects with invalid_png and no output", () => {
    const hostile = new TextEncoder().encode(
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "x">]><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description/></rdf:RDF></x:xmpmeta>',
    )
    const input = buildValidPng({ ancillary: [makeXmpItxt(hostile)] })

    const result = enrichPng(input, { provider: "chatgpt", originalPrompt: PROMPT })

    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.error.code).toBe("invalid_png")
    expect("outputBytes" in result).toBe(false)
  })

  it("when the PNG has duplicate XMP packets then it rejects with invalid_png", () => {
    const xmp = new TextEncoder().encode("<x:xmpmeta/>")
    const input = buildValidPng({ ancillary: [makeXmpItxt(xmp), makeXmpItxt(xmp)] })

    const result = enrichPng(input, { provider: "chatgpt", originalPrompt: PROMPT })

    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.error.code).toBe("invalid_png")
  })
})
