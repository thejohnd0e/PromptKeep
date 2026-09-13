import { describe, expect, it } from "vitest"
import {
  CONTROLLED_DIGITAL_SOURCE_TYPE,
  IPTC_EXTENSION_NAMESPACE,
  readIptcAiXmp,
  writeIptcAiXmp,
} from "../../../src/metadata/iptc-ai"
import { parseXmp, RDF_NAMESPACE } from "../../../src/metadata/xmp-reader"
import { LIMITS } from "../../../src/shared/contracts"
import { elementText, encodeXmp, findElements, loadXmpFixture } from "./xmp-test-helpers"

const EXACT_PROMPT = 'исходный промпт 🎨\n<&"\'\r xmlns:evil="urn:evil">'

describe("Given stale AI metadata and unrelated RDF properties", () => {
  it("when replaced then Unicode and XML-looking prompt text round-trips exactly", async () => {
    const source = await loadXmpFixture("stale-ai.xmp")

    const written = writeIptcAiXmp(source, {
      prompt: EXACT_PROMPT,
      system: "ChatGPT",
      observedVersion: "GPT-5",
    })
    expect(written.kind).toBe("ok")
    if (written.kind !== "ok") return
    const read = readIptcAiXmp(written.value)

    expect(read).toEqual({
      kind: "ok",
      value: {
        prompt: EXACT_PROMPT,
        system: "ChatGPT",
        systemVersion: "GPT-5",
        digitalSourceType: CONTROLLED_DIGITAL_SOURCE_TYPE,
      },
    })
  })

  it("when replaced then unrelated Dublin Core metadata remains exact", async () => {
    const source = await loadXmpFixture("stale-ai.xmp")

    const written = writeIptcAiXmp(source, { prompt: "new", system: "ChatGPT" })
    expect(written.kind).toBe("ok")
    if (written.kind !== "ok") return
    const parsed = parseXmp(written.value)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return
    const titles = findElements(parsed.value.root, "http://purl.org/dc/elements/1.1/", "title")
    const title = titles[0]

    expect(title === undefined ? undefined : elementText(title)).toBe("Unrelated Dublin Core title")
  })

  it("when the same values are written twice then outputs are byte-identical", async () => {
    const source = await loadXmpFixture("stale-ai.xmp")
    const values = { prompt: EXACT_PROMPT, system: "ChatGPT", observedVersion: "GPT-5" } as const

    const first = writeIptcAiXmp(source, values)
    expect(first.kind).toBe("ok")
    if (first.kind !== "ok") return
    const second = writeIptcAiXmp(first.value, values)

    expect(second.kind).toBe("ok")
    if (second.kind !== "ok") return
    expect(second.value).toEqual(first.value)
  })

  it("when the source has an xpacket wrapper then the rewrite retains its wrapper fields", () => {
    const source = encodeXmp(
      `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`,
    )

    const written = writeIptcAiXmp(source, { prompt: "new", system: "ChatGPT" })

    expect(written.kind).toBe("ok")
    if (written.kind !== "ok") return
    const xml = new TextDecoder().decode(written.value)
    expect(xml).toContain(`<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>`)
    expect(xml).toContain('<?xpacket end="w"?>')
  })

  it("when replaced then stale values and the forbidden writer are absent", async () => {
    const source = await loadXmpFixture("stale-ai.xmp")

    const written = writeIptcAiXmp(source, { prompt: "new", system: "ChatGPT" })
    expect(written.kind).toBe("ok")
    if (written.kind !== "ok") return
    const xml = new TextDecoder().decode(written.value)

    expect(xml).not.toContain("stale prompt")
    expect(xml).not.toContain("stale system")
    expect(xml).not.toContain("stale-attribute-version")
    expect(xml).not.toContain("stale-source")
    expect(xml).not.toContain("stale writer")
    expect(xml).not.toContain("AIPromptWriterName")
    expect(xml).not.toContain("dc:description")
    expect(xml).not.toContain("exif:")
  })

  it("when version is unknown or empty then no version property is emitted", async () => {
    const source = await loadXmpFixture("stale-ai.xmp")

    const unknown = writeIptcAiXmp(source, { prompt: "new", system: "ChatGPT" })
    const empty = writeIptcAiXmp(source, {
      prompt: "new",
      system: "ChatGPT",
      observedVersion: "  ",
    })

    expect(unknown.kind === "ok" ? new TextDecoder().decode(unknown.value) : "").not.toContain(
      "AISystemVersionUsed",
    )
    expect(empty.kind === "ok" ? new TextDecoder().decode(empty.value) : "").not.toContain(
      "AISystemVersionUsed",
    )
  })
})

describe("Given canonical IPTC namespace and RDF representations", () => {
  it("when written then the controlled URI is the only DigitalSourceType value", async () => {
    const source = await loadXmpFixture("unrelated-dc.xmp")

    const written = writeIptcAiXmp(source, { prompt: "new", system: "ChatGPT" })
    expect(written.kind).toBe("ok")
    if (written.kind !== "ok") return
    const xml = new TextDecoder().decode(written.value)

    expect(xml).toContain(`rdf:resource="${CONTROLLED_DIGITAL_SOURCE_TYPE}"`)
    expect(xml).toContain(`xmlns:Iptc4xmpExt="${IPTC_EXTENSION_NAMESPACE}"`)
  })

  it("when the same local name uses another namespace then it remains unrelated", () => {
    const source = encodeXmp(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:other="urn:other"><other:AIPromptInformation>keep me</other:AIPromptInformation></rdf:Description></rdf:RDF></x:xmpmeta>',
    )

    const written = writeIptcAiXmp(source, { prompt: "new", system: "ChatGPT" })

    expect(written.kind).toBe("ok")
    expect(written.kind === "ok" ? new TextDecoder().decode(written.value) : "").toContain(
      "<other:AIPromptInformation>keep me</other:AIPromptInformation>",
    )
  })

  it("when a canonical property is duplicated then it rejects instead of guessing", () => {
    const source = encodeXmp(
      `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:i="${IPTC_EXTENSION_NAMESPACE}" i:AIPromptInformation="one"><i:AIPromptInformation>two</i:AIPromptInformation></rdf:Description></rdf:RDF></x:xmpmeta>`,
    )

    const result = writeIptcAiXmp(source, { prompt: "new", system: "ChatGPT" })

    expect(result.kind === "rejected" ? result.error.code : undefined).toBe(
      "XMP_DUPLICATE_PROPERTY",
    )
  })

  it("when stale fields occur in nested RDF descriptions then it removes them recursively", () => {
    const source = encodeXmp(
      `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:i="${IPTC_EXTENSION_NAMESPACE}"><dc:relation><rdf:Description i:AIPromptWriterName="nested writer"><i:AISystemUsed>nested stale system</i:AISystemUsed></rdf:Description></dc:relation></rdf:Description></rdf:RDF></x:xmpmeta>`,
    )

    const written = writeIptcAiXmp(source, { prompt: "new", system: "ChatGPT" })

    expect(written.kind).toBe("ok")
    if (written.kind !== "ok") return
    const parsed = parseXmp(written.value)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return
    const xml = new TextDecoder().decode(written.value)
    const relations = findElements(
      parsed.value.root,
      "http://purl.org/dc/elements/1.1/",
      "relation",
    )
    const relation = relations[0]
    expect(
      relation === undefined ? [] : findElements(relation, RDF_NAMESPACE, "Description"),
    ).toHaveLength(1)
    expect(xml).not.toContain("nested writer")
    expect(xml).not.toContain("nested stale system")
  })

  it("when a text property is structured then it rejects instead of flattening it", () => {
    const source = encodeXmp(
      `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:i="${IPTC_EXTENSION_NAMESPACE}"><i:AIPromptInformation><rdf:Bag><rdf:li>one</rdf:li></rdf:Bag></i:AIPromptInformation></rdf:Description></rdf:RDF></x:xmpmeta>`,
    )

    const result = writeIptcAiXmp(source, { prompt: "new", system: "ChatGPT" })

    expect(result.kind === "rejected" ? result.error.code : undefined).toBe("XMP_INVALID_PROPERTY")
  })

  it("when prompt or system is empty then it rejects without output", async () => {
    const source = await loadXmpFixture("unrelated-dc.xmp")

    const prompt = writeIptcAiXmp(source, { prompt: " ", system: "ChatGPT" })
    const system = writeIptcAiXmp(source, { prompt: "new", system: "" })

    expect(prompt.kind === "rejected" ? prompt.error.code : undefined).toBe("XMP_INVALID_VALUE")
    expect(system.kind === "rejected" ? system.error.code : undefined).toBe("XMP_INVALID_VALUE")
  })

  it("when a multibyte prompt is at the UTF-8 limit then it writes without truncation", async () => {
    const source = await loadXmpFixture("unrelated-dc.xmp")
    const prompt = "🎨".repeat(LIMITS.maxPromptUtf8Bytes / 4)

    const result = writeIptcAiXmp(source, { prompt, system: "ChatGPT" })

    expect(new TextEncoder().encode(prompt)).toHaveLength(LIMITS.maxPromptUtf8Bytes)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const read = readIptcAiXmp(result.value)
    expect(read.kind === "ok" ? read.value.prompt : undefined).toBe(prompt)
  })

  it("when a multibyte prompt exceeds the UTF-8 limit by one byte then it rejects without bytes", async () => {
    const source = await loadXmpFixture("unrelated-dc.xmp")
    const prompt = `${"🎨".repeat(LIMITS.maxPromptUtf8Bytes / 4)}x`

    const result = writeIptcAiXmp(source, { prompt, system: "ChatGPT" })

    expect(result).toEqual({
      kind: "rejected",
      error: {
        code: "XMP_PROMPT_TOO_LARGE",
        actualBytes: LIMITS.maxPromptUtf8Bytes + 1,
        limitBytes: LIMITS.maxPromptUtf8Bytes,
      },
    })
  })

  it("when replacement serializes beyond the XMP limit then it rejects without bytes", () => {
    const largeUnrelatedValue = "é".repeat(524_200)
    const source = encodeXmp(
      `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description>${largeUnrelatedValue}</rdf:Description></rdf:RDF></x:xmpmeta>`,
    )
    expect(source.byteLength).toBeLessThanOrEqual(LIMITS.maxXmpBytes)

    const result = writeIptcAiXmp(source, { prompt: "new", system: "ChatGPT" })

    expect(result.kind).toBe("rejected")
    if (result.kind !== "rejected") return
    expect(result.error.code).toBe("XMP_OUTPUT_TOO_LARGE")
    if (result.error.code !== "XMP_OUTPUT_TOO_LARGE") return
    expect(result.error.actualBytes).toBeGreaterThan(LIMITS.maxXmpBytes)
    expect(result.error.limitBytes).toBe(LIMITS.maxXmpBytes)
  })

  it.each([
    ["prompt", { prompt: "bad\0prompt", system: "ChatGPT" }],
    ["system", { prompt: "new", system: "bad\ud800system" }],
    ["version", { prompt: "new", system: "ChatGPT", observedVersion: "bad\u0001version" }],
  ] as const)(
    "when %s contains XML 1.0-forbidden text then it rejects without output",
    (field, input) => {
      const source = encodeXmp(
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description/></rdf:RDF></x:xmpmeta>',
      )

      const result = writeIptcAiXmp(source, input)

      expect(result).toEqual({ kind: "rejected", error: { code: "XMP_INVALID_VALUE", field } })
    },
  )
})
