import {
  RDF_NAMESPACE,
  XMP_META_NAMESPACE,
  type XmpDocument,
  type XmpElement,
  type XmpNode,
  type XmpPacketWrapper,
  type XmpResult,
  xmpRejected,
} from "./xmp-types"

export type XpacketPosition = "before_root" | "inside_root" | "after_root"

export type XpacketInstruction = {
  readonly body: string
  readonly position: XpacketPosition
}

const XPACKET_ID = "W5M0MpCehiHzreSzNTczkc9d"
const HEADER_PATTERN = /^begin=(["'])(\uFEFF?)\1 id=(["'])W5M0MpCehiHzreSzNTczkc9d\3$/u
const TRAILER_PATTERN = /^end=(["'])([rw])\1$/u

function isElement(node: XmpNode): node is XmpElement {
  return node.kind === "element"
}

function matches(element: XmpElement, uri: string, local: string): boolean {
  return element.name.uri === uri && element.name.local === local
}

function allElements(root: XmpElement): readonly XmpElement[] {
  const elements: XmpElement[] = []
  const pending: XmpElement[] = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) continue
    elements.push(current)
    pending.push(...current.children.filter(isElement))
  }
  return elements
}

function parsePacketWrapper(
  instructions: readonly XpacketInstruction[],
): XmpResult<XmpPacketWrapper | undefined> {
  if (instructions.length === 0) return { kind: "ok", value: undefined }
  if (instructions.length !== 2) {
    return xmpRejected({
      code: "XMP_INVALID_PACKET",
      reason: "xpacket wrapper must contain one header and trailer",
    })
  }
  const header = instructions[0]
  const trailer = instructions[1]
  if (header?.position !== "before_root" || trailer?.position !== "after_root") {
    return xmpRejected({ code: "XMP_INVALID_PACKET", reason: "xpacket wrapper is misplaced" })
  }
  const headerMatch = HEADER_PATTERN.exec(header.body)
  const trailerMatch = TRAILER_PATTERN.exec(trailer.body)
  const begin = headerMatch?.[2]
  const end = trailerMatch?.[2]
  if ((begin !== "" && begin !== "\uFEFF") || (end !== "r" && end !== "w")) {
    return xmpRejected({ code: "XMP_INVALID_PACKET", reason: "malformed xpacket wrapper" })
  }
  return { kind: "ok", value: { begin, id: XPACKET_ID, end } }
}

export function validateXmpPacket(
  root: XmpElement,
  instructions: readonly XpacketInstruction[],
): XmpResult<XmpDocument> {
  const elements = allElements(root)
  const xmpmeta = elements.filter((element) => matches(element, XMP_META_NAMESPACE, "xmpmeta"))
  if (xmpmeta.length > 1) {
    return xmpRejected({ code: "XMP_DUPLICATE_PACKET", element: "xmpmeta" })
  }
  const rdfElements = elements.filter((element) => matches(element, RDF_NAMESPACE, "RDF"))
  if (rdfElements.length > 1) {
    return xmpRejected({ code: "XMP_DUPLICATE_PACKET", element: "RDF" })
  }
  if (xmpmeta.length !== 1 || xmpmeta[0] !== root) {
    return xmpRejected({ code: "XMP_INVALID_PACKET", reason: "root must be xmpmeta" })
  }
  const rootElements = root.children.filter(isElement)
  const rdf = rdfElements[0]
  if (rdf === undefined || rootElements.length !== 1 || rootElements[0] !== rdf) {
    return xmpRejected({ code: "XMP_INVALID_PACKET", reason: "xmpmeta must contain one RDF" })
  }
  if (root.children.some((node) => node.kind === "text" && node.value.trim() !== "")) {
    return xmpRejected({ code: "XMP_INVALID_PACKET", reason: "xmpmeta contains text" })
  }
  const descriptions = rdf.children.filter(
    (node) => node.kind === "element" && matches(node, RDF_NAMESPACE, "Description"),
  )
  if (descriptions.length === 0) {
    return xmpRejected({ code: "XMP_INVALID_PACKET", reason: "RDF must contain a Description" })
  }
  const wrapper = parsePacketWrapper(instructions)
  if (wrapper.kind === "rejected") return wrapper
  return {
    kind: "ok",
    value: {
      root,
      ...(wrapper.value === undefined ? {} : { packetWrapper: wrapper.value }),
    },
  }
}
