import { SaxesParser, type SaxesTagNS, type XMLDecl } from "saxes"
import { validateXmpPacket, type XpacketInstruction, type XpacketPosition } from "./xmp-packet"
import {
  XMLNS_NAMESPACE,
  XMP_LIMITS,
  type XmpAttribute,
  type XmpDocument,
  type XmpName,
  type XmpNode,
  type XmpResource,
  type XmpResult,
  xmpRejected,
} from "./xmp-types"

export {
  RDF_NAMESPACE,
  XMLNS_NAMESPACE,
  XMP_LIMITS,
  XMP_META_NAMESPACE,
  type XmpAttribute,
  type XmpDocument,
  type XmpElement,
  type XmpFailure,
  type XmpName,
  type XmpNode,
  type XmpPacketWrapper,
  type XmpResource,
  type XmpResult,
} from "./xmp-types"

type MutableElement = {
  readonly kind: "element"
  readonly name: XmpName
  readonly attributes: XmpAttribute[]
  readonly children: XmpNode[]
}

class ResourceLimitError extends Error {
  readonly name = "ResourceLimitError"

  constructor(
    readonly resource: XmpResource,
    readonly limit: number,
  ) {
    super(`XMP ${resource} limit exceeded`)
  }
}

class UnsupportedXmlError extends Error {
  readonly name = "UnsupportedXmlError"

  constructor(readonly construct: string) {
    super(`unsupported XML construct: ${construct}`)
  }
}

class UnsafeXmlError extends Error {
  readonly name = "UnsafeXmlError"
}

const PARSER_OPTIONS = {
  xmlns: true,
  fragment: false,
  defaultXMLVersion: "1.0",
  forceXMLVersion: true,
} as const

const UNSAFE_DECLARATION = /<!(?:DOCTYPE|ENTITY)\b/iu

function resourceLimit(resource: XmpResource, actual: number, limit: number): void {
  if (actual > limit) throw new ResourceLimitError(resource, limit)
}

function xmpName(tag: SaxesTagNS): XmpName {
  return { qualified: tag.name, prefix: tag.prefix, local: tag.local, uri: tag.uri }
}

function xmpAttributes(tag: SaxesTagNS): readonly XmpAttribute[] {
  return Object.values(tag.attributes).map((attribute) => ({
    qualified: attribute.name,
    prefix: attribute.prefix,
    local: attribute.local,
    uri: attribute.uri,
    value: attribute.value,
  }))
}

function validateDeclaration(declaration: XMLDecl): void {
  const encoding = declaration.encoding?.toLowerCase()
  if (
    declaration.version !== "1.0" ||
    (encoding !== undefined && encoding !== "utf-8") ||
    declaration.standalone !== undefined
  ) {
    throw new UnsupportedXmlError("xml_declaration")
  }
}

function parseDecodedXmp(xml: string): XmpResult<XmpDocument> {
  const parser = new SaxesParser(PARSER_OPTIONS)
  const stack: MutableElement[] = []
  let root: MutableElement | undefined
  let elementCount = 0
  let nodeCount = 0
  let attributeCount = 0
  let namespaceCount = 0
  let textCharacters = 0
  const xpacketInstructions: XpacketInstruction[] = []
  let xpacketPosition: XpacketPosition = "before_root"

  parser.on("xmldecl", validateDeclaration)
  parser.on("doctype", () => {
    throw new UnsafeXmlError()
  })
  parser.on("comment", () => {
    throw new UnsupportedXmlError("comment")
  })
  parser.on("cdata", () => {
    throw new UnsupportedXmlError("cdata")
  })
  parser.on("processinginstruction", (instruction) => {
    if (instruction.target !== "xpacket") {
      throw new UnsupportedXmlError("processing_instruction")
    }
    xpacketInstructions.push({ body: instruction.body, position: xpacketPosition })
  })
  parser.on("opentag", (tag) => {
    if (stack.length === 0) xpacketPosition = "inside_root"
    const attributes = [...xmpAttributes(tag)]
    elementCount += 1
    nodeCount += 1
    attributeCount += attributes.length
    namespaceCount += attributes.filter((attribute) => attribute.uri === XMLNS_NAMESPACE).length
    resourceLimit("depth", stack.length + 1, XMP_LIMITS.maxDepth)
    resourceLimit("elements", elementCount, XMP_LIMITS.maxElements)
    resourceLimit("nodes", nodeCount, XMP_LIMITS.maxNodes)
    resourceLimit("attributes_per_element", attributes.length, XMP_LIMITS.maxAttributesPerElement)
    resourceLimit("total_attributes", attributeCount, XMP_LIMITS.maxTotalAttributes)
    resourceLimit("namespaces", namespaceCount, XMP_LIMITS.maxNamespaces)
    const element: MutableElement = {
      kind: "element",
      name: xmpName(tag),
      attributes,
      children: [],
    }
    const parent = stack.at(-1)
    if (parent === undefined) root = element
    else parent.children.push(element)
    stack.push(element)
  })
  parser.on("text", (value) => {
    if (value.length === 0) return
    const parent = stack.at(-1)
    if (parent === undefined) return
    nodeCount += 1
    textCharacters += value.length
    resourceLimit("nodes", nodeCount, XMP_LIMITS.maxNodes)
    resourceLimit("text", textCharacters, XMP_LIMITS.maxTextCharacters)
    parent.children.push({ kind: "text", value })
  })
  parser.on("closetag", () => {
    stack.pop()
    if (stack.length === 0) xpacketPosition = "after_root"
  })

  try {
    parser.write(xml).close()
  } catch (error) {
    if (error instanceof ResourceLimitError) {
      return xmpRejected({
        code: "XMP_RESOURCE_LIMIT",
        resource: error.resource,
        limit: error.limit,
      })
    }
    if (error instanceof UnsafeXmlError) return xmpRejected({ code: "XMP_UNSAFE_XML" })
    if (error instanceof UnsupportedXmlError) {
      return xmpRejected({ code: "XMP_UNSUPPORTED_XML", construct: error.construct })
    }
    if (error instanceof Error) return xmpRejected({ code: "XMP_MALFORMED_XML" })
    throw error
  }
  if (root === undefined) {
    return xmpRejected({ code: "XMP_INVALID_PACKET", reason: "missing root" })
  }
  return validateXmpPacket(root, xpacketInstructions)
}

export function parseXmp(input: Uint8Array): XmpResult<XmpDocument> {
  if (input.byteLength > XMP_LIMITS.maxInputBytes) {
    return xmpRejected({
      code: "XMP_TOO_LARGE",
      actualBytes: input.byteLength,
      limitBytes: XMP_LIMITS.maxInputBytes,
    })
  }
  let xml: string
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(input)
  } catch (error) {
    if (error instanceof TypeError) return xmpRejected({ code: "XMP_INVALID_UTF8" })
    throw error
  }
  if (UNSAFE_DECLARATION.test(xml)) return xmpRejected({ code: "XMP_UNSAFE_XML" })
  return parseDecodedXmp(xml)
}
