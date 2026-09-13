import { LIMITS } from "../shared/contracts"

export const XMP_META_NAMESPACE = "adobe:ns:meta/"
export const RDF_NAMESPACE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
export const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/"

export const XMP_LIMITS = {
  maxInputBytes: LIMITS.maxXmpBytes,
  maxDepth: 64,
  maxElements: 4_096,
  maxNodes: 6_000,
  maxAttributesPerElement: 32,
  maxTotalAttributes: 4_096,
  maxNamespaces: 128,
  maxTextCharacters: 512 * 1_024,
} as const

export type XmpResource =
  | "depth"
  | "elements"
  | "nodes"
  | "attributes_per_element"
  | "total_attributes"
  | "namespaces"
  | "text"

export type XmpName = {
  readonly qualified: string
  readonly prefix: string
  readonly local: string
  readonly uri: string
}

export type XmpAttribute = XmpName & {
  readonly value: string
}

export type XmpText = {
  readonly kind: "text"
  readonly value: string
}

export type XmpElement = {
  readonly kind: "element"
  readonly name: XmpName
  readonly attributes: readonly XmpAttribute[]
  readonly children: readonly XmpNode[]
}

export type XmpNode = XmpElement | XmpText

export type XmpPacketWrapper = {
  readonly begin: "" | "\uFEFF"
  readonly id: "W5M0MpCehiHzreSzNTczkc9d"
  readonly end: "r" | "w"
}

export type XmpDocument = {
  readonly root: XmpElement
  readonly packetWrapper?: XmpPacketWrapper
}

export type XmpFailure =
  | { readonly code: "XMP_TOO_LARGE"; readonly actualBytes: number; readonly limitBytes: number }
  | { readonly code: "XMP_INVALID_UTF8" }
  | { readonly code: "XMP_UNSAFE_XML" }
  | { readonly code: "XMP_MALFORMED_XML" }
  | { readonly code: "XMP_UNSUPPORTED_XML"; readonly construct: string }
  | { readonly code: "XMP_RESOURCE_LIMIT"; readonly resource: XmpResource; readonly limit: number }
  | { readonly code: "XMP_INVALID_PACKET"; readonly reason: string }
  | { readonly code: "XMP_DUPLICATE_PACKET"; readonly element: "xmpmeta" | "RDF" }
  | { readonly code: "XMP_DUPLICATE_PROPERTY"; readonly property: string }
  | { readonly code: "XMP_INVALID_PROPERTY"; readonly property: string }
  | { readonly code: "XMP_INVALID_VALUE"; readonly field: "prompt" | "system" | "version" }
  | {
      readonly code: "XMP_PROMPT_TOO_LARGE"
      readonly actualBytes: number
      readonly limitBytes: number
    }
  | {
      readonly code: "XMP_OUTPUT_TOO_LARGE"
      readonly actualBytes: number
      readonly limitBytes: number
    }

export type XmpResult<Value> =
  | { readonly kind: "ok"; readonly value: Value }
  | { readonly kind: "rejected"; readonly error: XmpFailure }

export function xmpRejected<Value>(error: XmpFailure): XmpResult<Value> {
  return { kind: "rejected", error }
}
