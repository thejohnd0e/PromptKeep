import { describe, expect, it } from "vitest"
import {
  parseXmp,
  RDF_NAMESPACE,
  XMP_META_NAMESPACE,
  type XmpFailure,
} from "../../../src/metadata/xmp-reader"
import { elementText, encodeXmp, findElements, loadXmpFixture } from "./xmp-test-helpers"

function rejectedCode(input: Uint8Array): XmpFailure["code"] | undefined {
  const result = parseXmp(input)
  return result.kind === "rejected" ? result.error.code : undefined
}

const WRAPPER_START = `<x:xmpmeta xmlns:x="${XMP_META_NAMESPACE}"><rdf:RDF xmlns:rdf="${RDF_NAMESPACE}"><rdf:Description rdf:about="">`
const WRAPPER_END = "</rdf:Description></rdf:RDF></x:xmpmeta>"
const XPACKET_BEGIN = '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>'
const XPACKET_END = '<?xpacket end="w"?>'

describe("Given a namespace-aware XMP packet", () => {
  it("when parsed then it retains exact namespace identities and unrelated text", async () => {
    const input = await loadXmpFixture("unrelated-dc.xmp")

    const result = parseXmp(input)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.value.root.name).toEqual({
      qualified: "x:xmpmeta",
      prefix: "x",
      local: "xmpmeta",
      uri: XMP_META_NAMESPACE,
    })
    const titles = findElements(result.value.root, "http://purl.org/dc/elements/1.1/", "title")
    expect(titles).toHaveLength(1)
    const title = titles[0]
    expect(title === undefined ? undefined : elementText(title)).toBe("Unrelated Dublin Core title")
  })

  it("when predefined and numeric entities are parsed then their text remains inert", () => {
    const input = encodeXmp(`${WRAPPER_START}A &amp; B &#x1F3A8;${WRAPPER_END}`)

    const result = parseXmp(input)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    const descriptions = findElements(result.value.root, RDF_NAMESPACE, "Description")
    const description = descriptions[0]
    expect(description === undefined ? undefined : elementText(description)).toBe("A & B 🎨")
  })

  it("when an xpacket wrapper surrounds the root then it retains the packet fields", () => {
    const input = encodeXmp(`${XPACKET_BEGIN}\n${WRAPPER_START}${WRAPPER_END}\n${XPACKET_END}`)

    const result = parseXmp(input)

    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.value.packetWrapper).toEqual({
      begin: "\uFEFF",
      id: "W5M0MpCehiHzreSzNTczkc9d",
      end: "w",
    })
  })
})

describe("Given unsafe or malformed XML", () => {
  it("when a DOCTYPE or entity declaration is present then it rejects before acceptance", async () => {
    const input = await loadXmpFixture("hostile-doctype.xmp")

    const code = rejectedCode(input)

    expect(code).toBe("XMP_UNSAFE_XML")
  })

  it("when UTF-8 is invalid then it rejects without replacement decoding", () => {
    const code = rejectedCode(new Uint8Array([0xc3, 0x28]))

    expect(code).toBe("XMP_INVALID_UTF8")
  })

  it("when XML is malformed then it returns the typed malformed error", () => {
    const code = rejectedCode(encodeXmp(`${WRAPPER_START}<dc:title>${WRAPPER_END}`))

    expect(code).toBe("XMP_MALFORMED_XML")
  })

  it.each([
    ["comment", "<!-- hidden -->"],
    ["CDATA", "<![CDATA[hidden]]>"],
    ["processing instruction", "<?hidden value?>"],
  ])("when a %s cannot be preserved then it rejects the construct", (_name, construct) => {
    const code = rejectedCode(encodeXmp(`${WRAPPER_START}${construct}${WRAPPER_END}`))

    expect(code).toBe("XMP_UNSUPPORTED_XML")
  })
})

describe("Given a non-canonical packet shape", () => {
  it.each([
    ["missing trailer", `${XPACKET_BEGIN}${WRAPPER_START}${WRAPPER_END}`],
    [
      "duplicate header",
      `${XPACKET_BEGIN}${XPACKET_BEGIN}${WRAPPER_START}${WRAPPER_END}${XPACKET_END}`,
    ],
    ["embedded header", `${WRAPPER_START}${XPACKET_BEGIN}${WRAPPER_END}${XPACKET_END}`],
    ["malformed trailer", `${XPACKET_BEGIN}${WRAPPER_START}${WRAPPER_END}<?xpacket end="yes"?>`],
  ])("when xpacket has a %s then it rejects the packet", (_name, source) => {
    expect(rejectedCode(encodeXmp(source))).toBe("XMP_INVALID_PACKET")
  })

  it("when xmpmeta occurs twice then it rejects the duplicate packet wrapper", () => {
    const nested = `<x:xmpmeta xmlns:x="${XMP_META_NAMESPACE}"><rdf:RDF xmlns:rdf="${RDF_NAMESPACE}"><rdf:Description><x:xmpmeta/></rdf:Description></rdf:RDF></x:xmpmeta>`

    const code = rejectedCode(encodeXmp(nested))

    expect(code).toBe("XMP_DUPLICATE_PACKET")
  })

  it("when rdf:RDF occurs twice then it rejects rather than choosing one", () => {
    const duplicate = `<x:xmpmeta xmlns:x="${XMP_META_NAMESPACE}"><rdf:RDF xmlns:rdf="${RDF_NAMESPACE}"><rdf:Description/></rdf:RDF><rdf:RDF xmlns:rdf="${RDF_NAMESPACE}"><rdf:Description/></rdf:RDF></x:xmpmeta>`

    const code = rejectedCode(encodeXmp(duplicate))

    expect(code).toBe("XMP_DUPLICATE_PACKET")
  })

  it("when the RDF namespace is only similar then it rejects the packet", () => {
    const fuzzy = `<x:xmpmeta xmlns:x="${XMP_META_NAMESPACE}"><rdf:RDF xmlns:rdf="${RDF_NAMESPACE}wrong"><rdf:Description/></rdf:RDF></x:xmpmeta>`

    const code = rejectedCode(encodeXmp(fuzzy))

    expect(code).toBe("XMP_INVALID_PACKET")
  })
})
