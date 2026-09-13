import {
  XMLNS_NAMESPACE,
  type XmpAttribute,
  type XmpDocument,
  type XmpElement,
  type XmpNode,
} from "./xmp-reader"

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function compareAttributes(left: XmpAttribute, right: XmpAttribute): number {
  const leftNamespace = left.uri === XMLNS_NAMESPACE
  const rightNamespace = right.uri === XMLNS_NAMESPACE
  if (leftNamespace !== rightNamespace) return leftNamespace ? -1 : 1
  const uriOrder = compareText(left.uri, right.uri)
  if (uriOrder !== 0) return uriOrder
  const localOrder = compareText(left.local, right.local)
  return localOrder !== 0 ? localOrder : compareText(left.qualified, right.qualified)
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\r", "&#13;")
}

function escapeAttribute(value: string): string {
  return escapeText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("\t", "&#9;")
    .replaceAll("\n", "&#10;")
}

function serializeNode(node: XmpNode): string {
  if (node.kind === "text") return escapeText(node.value)
  return serializeElement(node)
}

function serializeElement(element: XmpElement): string {
  const attributes = [...element.attributes]
    .sort(compareAttributes)
    .map((attribute) => ` ${attribute.qualified}="${escapeAttribute(attribute.value)}"`)
    .join("")
  if (element.children.length === 0) return `<${element.name.qualified}${attributes}/>`
  const children = element.children.map(serializeNode).join("")
  return `<${element.name.qualified}${attributes}>${children}</${element.name.qualified}>`
}

export function serializeXmp(document: XmpDocument): Uint8Array {
  const root = serializeElement(document.root)
  const wrapper = document.packetWrapper
  const body =
    wrapper === undefined
      ? root
      : `<?xpacket begin="${wrapper.begin}" id="${wrapper.id}"?>\n${root}\n<?xpacket end="${wrapper.end}"?>`
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${body}`
  return new TextEncoder().encode(xml)
}
