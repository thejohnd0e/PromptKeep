import { describe, expect, it } from "vitest"
import {
  parseXmp,
  RDF_NAMESPACE,
  XMP_LIMITS,
  XMP_META_NAMESPACE,
  type XmpResource,
} from "../../../src/metadata/xmp-reader"
import { encodeXmp } from "./xmp-test-helpers"

const START = `<x:xmpmeta xmlns:x="${XMP_META_NAMESPACE}"><rdf:RDF xmlns:rdf="${RDF_NAMESPACE}"><rdf:Description rdf:about="" xmlns:n="urn:test">`
const END = "</rdf:Description></rdf:RDF></x:xmpmeta>"

function resourceFor(xml: string): XmpResource | undefined {
  const result = parseXmp(encodeXmp(xml))
  return result.kind === "rejected" && result.error.code === "XMP_RESOURCE_LIMIT"
    ? result.error.resource
    : undefined
}

describe("Given bounded XMP parsing", () => {
  it("when input exceeds one MiB then it rejects before parsing", () => {
    const input = new Uint8Array(XMP_LIMITS.maxInputBytes + 1)

    const result = parseXmp(input)

    expect(result).toEqual({
      kind: "rejected",
      error: {
        code: "XMP_TOO_LARGE",
        actualBytes: XMP_LIMITS.maxInputBytes + 1,
        limitBytes: XMP_LIMITS.maxInputBytes,
      },
    })
  })

  it("when nesting exceeds the depth limit then it rejects depth", () => {
    const nested = "<n:e>".repeat(XMP_LIMITS.maxDepth) + "</n:e>".repeat(XMP_LIMITS.maxDepth)

    expect(resourceFor(`${START}${nested}${END}`)).toBe("depth")
  })

  it("when element count exceeds its limit then it rejects elements", () => {
    const elements = "<n:e/>".repeat(XMP_LIMITS.maxElements)

    expect(resourceFor(`${START}${elements}${END}`)).toBe("elements")
  })

  it("when node count exceeds its limit then it rejects nodes", () => {
    const elementsWithText = "<n:e>x</n:e>".repeat(Math.ceil(XMP_LIMITS.maxNodes / 2))

    expect(resourceFor(`${START}${elementsWithText}${END}`)).toBe("nodes")
  })

  it("when one element has too many attributes then it rejects per-element attributes", () => {
    const attributes = Array.from(
      { length: XMP_LIMITS.maxAttributesPerElement + 1 },
      (_, index) => ` a${String(index)}="v"`,
    ).join("")

    expect(resourceFor(`${START}<n:e${attributes}/>${END}`)).toBe("attributes_per_element")
  })

  it("when total attributes exceed their limit then it rejects total attributes", () => {
    const attributes = Array.from(
      { length: XMP_LIMITS.maxAttributesPerElement },
      (_, index) => ` a${String(index)}="v"`,
    ).join("")
    const elements = `<n:e${attributes}/>`.repeat(
      Math.ceil(XMP_LIMITS.maxTotalAttributes / XMP_LIMITS.maxAttributesPerElement),
    )

    expect(resourceFor(`${START}${elements}${END}`)).toBe("total_attributes")
  })

  it("when namespace declarations exceed their limit then it rejects namespaces", () => {
    const elementCount = Math.ceil(
      (XMP_LIMITS.maxNamespaces + 1) / XMP_LIMITS.maxAttributesPerElement,
    )
    const elements = Array.from({ length: elementCount }, (_, elementIndex) => {
      const namespaces = Array.from(
        { length: XMP_LIMITS.maxAttributesPerElement },
        (_, attributeIndex) => {
          const index = elementIndex * XMP_LIMITS.maxAttributesPerElement + attributeIndex
          return ` xmlns:n${String(index)}="urn:test:${String(index)}"`
        },
      ).join("")
      return `<n:e${namespaces}/>`
    }).join("")

    expect(resourceFor(`${START}${elements}${END}`)).toBe("namespaces")
  })

  it("when total text exceeds its limit then it rejects text", () => {
    const text = "x".repeat(XMP_LIMITS.maxTextCharacters + 1)

    expect(resourceFor(`${START}${text}${END}`)).toBe("text")
  })
})
