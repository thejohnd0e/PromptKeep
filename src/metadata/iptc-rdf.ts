import {
  RDF_NAMESPACE,
  XMLNS_NAMESPACE,
  type XmpAttribute,
  type XmpDocument,
  type XmpElement,
  type XmpNode,
  type XmpResult,
} from "./xmp-reader"
import { xmpRejected } from "./xmp-types"

export const IPTC_EXTENSION_NAMESPACE = "http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
export const CONTROLLED_DIGITAL_SOURCE_TYPE =
  "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"

const TARGET_PROPERTIES = [
  "AIPromptInformation",
  "AISystemUsed",
  "AISystemVersionUsed",
  "DigitalSourceType",
  "AIPromptWriterName",
] as const

export type TargetProperty = (typeof TARGET_PROPERTIES)[number]

export type IptcWriteValues = {
  readonly prompt: string
  readonly system: string
  readonly observedVersion?: string
}

export type IptcReadValues = {
  readonly prompt?: string
  readonly system?: string
  readonly systemVersion?: string
  readonly digitalSourceType?: string
}

export type RdfInspection = {
  readonly rdf: XmpElement
  readonly destination: XmpElement
  readonly values: ReadonlyMap<TargetProperty, string>
}

export function isElement(node: XmpNode): node is XmpElement {
  return node.kind === "element"
}

function isTarget(local: string): local is TargetProperty {
  return TARGET_PROPERTIES.some((property) => property === local)
}

export function targetName(attribute: XmpAttribute): TargetProperty | undefined {
  return attribute.uri === IPTC_EXTENSION_NAMESPACE && isTarget(attribute.local)
    ? attribute.local
    : undefined
}

export function targetElement(element: XmpElement): TargetProperty | undefined {
  return element.name.uri === IPTC_EXTENSION_NAMESPACE && isTarget(element.name.local)
    ? element.name.local
    : undefined
}

function namespaceAttribute(attribute: XmpAttribute): boolean {
  return attribute.uri === XMLNS_NAMESPACE
}

function propertyValue(element: XmpElement, property: TargetProperty): XmpResult<string> {
  const attributes = element.attributes.filter((attribute) => !namespaceAttribute(attribute))
  if (property === "DigitalSourceType") {
    const resource = attributes.find(
      (attribute) => attribute.uri === RDF_NAMESPACE && attribute.local === "resource",
    )
    const scalar = element.children.every(
      (child) => child.kind === "text" && child.value.trim() === "",
    )
    if (attributes.length !== 1 || resource === undefined || !scalar) {
      return xmpRejected({ code: "XMP_INVALID_PROPERTY", property })
    }
    return { kind: "ok", value: resource.value }
  }
  if (attributes.length !== 0 || element.children.some(isElement)) {
    return xmpRejected({ code: "XMP_INVALID_PROPERTY", property })
  }
  return {
    kind: "ok",
    value: element.children.map((child) => (child.kind === "text" ? child.value : "")).join(""),
  }
}

export function inspectRdf(document: XmpDocument): XmpResult<RdfInspection> {
  const rdf = document.root.children
    .filter(isElement)
    .find((element) => element.name.uri === RDF_NAMESPACE && element.name.local === "RDF")
  if (rdf === undefined) {
    return xmpRejected({ code: "XMP_INVALID_PACKET", reason: "missing RDF" })
  }
  const destination = rdf.children
    .filter(isElement)
    .find((element) => element.name.uri === RDF_NAMESPACE && element.name.local === "Description")
  if (destination === undefined) {
    return xmpRejected({ code: "XMP_INVALID_PACKET", reason: "missing RDF Description" })
  }
  const values = new Map<TargetProperty, string>()
  const subjects = [...rdf.children.filter(isElement)]
  while (subjects.length > 0) {
    const subject = subjects.pop()
    if (subject === undefined) continue
    for (const attribute of subject.attributes) {
      const property = targetName(attribute)
      if (property === undefined) continue
      if (property === "DigitalSourceType") {
        return xmpRejected({ code: "XMP_INVALID_PROPERTY", property })
      }
      if (values.has(property)) {
        return xmpRejected({ code: "XMP_DUPLICATE_PROPERTY", property })
      }
      values.set(property, attribute.value)
    }
    const childElements = subject.children.filter(isElement)
    for (const child of childElements) {
      const property = targetElement(child)
      if (property === undefined) continue
      if (values.has(property)) {
        return xmpRejected({ code: "XMP_DUPLICATE_PROPERTY", property })
      }
      const value = propertyValue(child, property)
      if (value.kind === "rejected") return value
      values.set(property, value.value)
    }
    subjects.push(...childElements)
  }
  return { kind: "ok", value: { rdf, destination, values } }
}

function readValues(values: ReadonlyMap<TargetProperty, string>): IptcReadValues {
  const prompt = values.get("AIPromptInformation")
  const system = values.get("AISystemUsed")
  const systemVersion = values.get("AISystemVersionUsed")
  const digitalSourceType = values.get("DigitalSourceType")
  return {
    ...(prompt === undefined ? {} : { prompt }),
    ...(system === undefined ? {} : { system }),
    ...(systemVersion === undefined ? {} : { systemVersion }),
    ...(digitalSourceType === undefined ? {} : { digitalSourceType }),
  }
}

export function readIptcValues(document: XmpDocument): XmpResult<IptcReadValues> {
  const inspection = inspectRdf(document)
  return inspection.kind === "rejected"
    ? inspection
    : { kind: "ok", value: readValues(inspection.value.values) }
}
