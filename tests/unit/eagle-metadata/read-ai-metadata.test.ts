import { describe, expect, it } from "vitest"
import { readAiMetadata } from "../../../eagle-plugin/src/read-ai-metadata"
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
} from "../../fixtures/png/png-fixtures"

const UNICODE_PROMPT = "исходный промпт 🎨 a serene mountain lake at dawn"

describe("Given readAiMetadata", () => {
  it("when reading a Chrome-enriched PNG then it returns present with the exact Unicode prompt, system, version, and source type", () => {
    const enriched = enrichPng(buildValidPng(), {
      provider: "chatgpt",
      originalPrompt: UNICODE_PROMPT,
      observedVersion: "GPT-5",
    })
    expect(enriched.kind).toBe("ok")
    if (enriched.kind !== "ok") return

    const result = readAiMetadata(enriched.value.outputBytes)

    expect(result).toEqual({
      kind: "present",
      value: {
        prompt: UNICODE_PROMPT,
        system: "ChatGPT",
        systemVersion: "GPT-5",
        digitalSourceType: CONTROLLED_DIGITAL_SOURCE_TYPE,
      },
    })
  })

  it("when the same reference PNG is read by the shared parser and the Eagle wrapper then the metadata is identical", () => {
    const enriched = enrichPng(buildValidPng(), {
      provider: "grok",
      originalPrompt: UNICODE_PROMPT,
      observedVersion: "3",
    })
    expect(enriched.kind).toBe("ok")
    if (enriched.kind !== "ok") return

    const parsed = parsePng(enriched.value.outputBytes)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return
    const xmp = parsed.value.xmp?.data
    expect(xmp).toBeDefined()
    if (xmp === undefined) return
    const shared = readIptcAiXmp(xmp)
    expect(shared.kind).toBe("ok")
    if (shared.kind !== "ok") return

    const eagle = readAiMetadata(enriched.value.outputBytes)

    expect(eagle).toEqual({ kind: "present", value: shared.value })
  })

  it("when the optional version is missing then present omits systemVersion", () => {
    const enriched = enrichPng(buildValidPng(), {
      provider: "gemini",
      originalPrompt: UNICODE_PROMPT,
    })
    expect(enriched.kind).toBe("ok")
    if (enriched.kind !== "ok") return

    const result = readAiMetadata(enriched.value.outputBytes)

    expect(result.kind).toBe("present")
    if (result.kind !== "present") return
    expect(result.value).not.toHaveProperty("systemVersion")
    expect(result.value.system).toBe("Google Gemini")
    expect(result.value.digitalSourceType).toBe(CONTROLLED_DIGITAL_SOURCE_TYPE)
  })

  it("when the PNG has no XMP packet then it reports absent", () => {
    const result = readAiMetadata(buildValidPng())

    expect(result).toEqual({ kind: "absent" })
  })

  it("when the PNG contains only unrelated Stable Diffusion-style XMP then it reports absent, never misclassified", () => {
    const unrelated = new TextEncoder().encode(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:sd="http://ns.adobe.com/xap/1.0/sd/"><sd:parameters>Steps: 20, Sampler: Euler a, CFG scale: 7</sd:parameters></rdf:Description></rdf:RDF></x:xmpmeta>',
    )
    const input = buildValidPng({ ancillary: [makeXmpItxt(unrelated)] })

    const result = readAiMetadata(input)

    expect(result).toEqual({ kind: "absent" })
  })

  it("when the XMP contains only a partial IPTC AI field then it reports absent", () => {
    const partial = new TextEncoder().encode(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"><Iptc4xmpExt:AIPromptInformation>only a prompt</Iptc4xmpExt:AIPromptInformation></rdf:Description></rdf:RDF></x:xmpmeta>',
    )
    const input = buildValidPng({ ancillary: [makeXmpItxt(partial)] })

    const result = readAiMetadata(input)

    expect(result).toEqual({ kind: "absent" })
  })

  it("when the PNG has a bad CRC then it returns a safe malformed error", () => {
    const input = buildValidPng()
    const lastByte = input[input.byteLength - 1] ?? 0
    input[input.byteLength - 1] = lastByte ^ 0xff

    const result = readAiMetadata(input)

    expect(result.kind).toBe("malformed")
    if (result.kind !== "malformed") return
    expect(result.error.code).toBe("PNG_CRC_MISMATCH")
  })

  it("when the embedded XMP is hostile then it returns a safe malformed error", () => {
    const hostile = new TextEncoder().encode(
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "x">]><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description/></rdf:RDF></x:xmpmeta>',
    )
    const input = buildValidPng({ ancillary: [makeXmpItxt(hostile)] })

    const result = readAiMetadata(input)

    expect(result.kind).toBe("malformed")
    if (result.kind !== "malformed") return
    expect(result.error.code).toBe("XMP_UNSAFE_XML")
  })

  it("when the PNG is an APNG then it returns an unsupported error with the same code as the shared reader", () => {
    const input = buildValidPng({ ancillary: [makeChunk("acTL", new Uint8Array(8))] })

    const result = readAiMetadata(input)

    expect(result.kind).toBe("unsupported")
    if (result.kind !== "unsupported") return
    expect(result.error).toEqual({ code: "PNG_UNSUPPORTED_APNG", chunkType: "acTL" })
  })

  it("when the embedded XMP exceeds the read limit then it returns an unsupported error with the same limit as the shared reader", () => {
    const input = buildValidPng({
      ancillary: [makeXmpItxt(new Uint8Array(LIMITS.maxXmpBytes + 1))],
    })

    const result = readAiMetadata(input)

    expect(result.kind).toBe("unsupported")
    if (result.kind !== "unsupported") return
    expect(result.error.code).toBe("PNG_XMP_TOO_LARGE")
    if (result.error.code !== "PNG_XMP_TOO_LARGE") return
    expect(result.error.limitBytes).toBe(LIMITS.maxXmpBytes)
  })

  it("when the chunk count exceeds the read limit then it returns an unsupported error with the same limit as the shared reader", () => {
    const filler = Array.from({ length: LIMITS.maxPngChunks - 1 }, () =>
      makeChunk("tEXt", new Uint8Array(0)),
    )
    const input = buildPng([makeIhdr(1, 1), ...filler, makeIend()])

    const result = readAiMetadata(input)

    expect(result.kind).toBe("unsupported")
    if (result.kind !== "unsupported") return
    expect(result.error.code).toBe("PNG_TOO_MANY_CHUNKS")
    if (result.error.code !== "PNG_TOO_MANY_CHUNKS") return
    expect(result.error.limitChunks).toBe(LIMITS.maxPngChunks)
  })

  it("when the file exceeds the input limit then it returns an unsupported error with the same limit as the shared reader", {
    timeout: 15_000,
  }, () => {
    const idat = makeChunk("IDAT", new Uint8Array(LIMITS.maxInputBytes - 56))
    const input = buildPng([makeIhdr(1, 1), idat, makeIend()])
    expect(input.byteLength).toBe(LIMITS.maxInputBytes + 1)

    const result = readAiMetadata(input)

    expect(result.kind).toBe("unsupported")
    if (result.kind !== "unsupported") return
    expect(result.error.code).toBe("PNG_INPUT_TOO_LARGE")
    if (result.error.code !== "PNG_INPUT_TOO_LARGE") return
    expect(result.error.limitBytes).toBe(LIMITS.maxInputBytes)
  })
})
