import {
  CONTROLLED_DIGITAL_SOURCE_TYPE,
  IPTC_EXTENSION_NAMESPACE,
  type IptcWriteValues,
  inspectRdf,
  isElement,
  type RdfInspection,
  type TargetProperty,
  targetElement,
  targetName,
} from "./iptc-rdf"
import {
  RDF_NAMESPACE,
  XMLNS_NAMESPACE,
  type XmpAttribute,
  type XmpDocument,
  type XmpElement,
  type XmpName,
  type XmpResult,
} from "./xmp-reader"

function xmlName(prefix: string, local: string, uri: string): XmpName {
  return { qualified: `${prefix}:${local}`, prefix, local, uri }
}

function declaration(prefix: string, uri: string): XmpAttribute {
  return { ...xmlName("xmlns", prefix, XMLNS_NAMESPACE), value: uri }
}

function namespaceScope(
  document: XmpDocument,
  inspection: RdfInspection,
): ReadonlyMap<string, string> {
  const namespaces = new Map<string, string>()
  for (const element of [document.root, inspection.rdf, inspection.destination]) {
    for (const attribute of element.attributes) {
      if (attribute.uri !== XMLNS_NAMESPACE) continue
      namespaces.set(attribute.qualified === "xmlns" ? "" : attribute.local, attribute.value)
    }
  }
  return namespaces
}

function choosePrefix(
  preferred: string,
  uri: string,
  namespaces: ReadonlyMap<string, string>,
): string {
  let candidate = preferred
  let suffix = 0
  while (namespaces.has(candidate) && namespaces.get(candidate) !== uri) {
    suffix += 1
    candidate = `${preferred}${String(suffix)}`
  }
  return candidate
}

function textProperty(prefix: string, local: TargetProperty, value: string): XmpElement {
  return {
    kind: "element",
    name: xmlName(prefix, local, IPTC_EXTENSION_NAMESPACE),
    attributes: [],
    children: [{ kind: "text", value }],
  }
}

function sourceProperty(iptcPrefix: string, rdfPrefix: string): XmpElement {
  return {
    kind: "element",
    name: xmlName(iptcPrefix, "DigitalSourceType", IPTC_EXTENSION_NAMESPACE),
    attributes: [
      {
        ...xmlName(rdfPrefix, "resource", RDF_NAMESPACE),
        value: CONTROLLED_DIGITAL_SOURCE_TYPE,
      },
    ],
    children: [],
  }
}

function cleanSubject(subject: XmpElement): XmpElement {
  const retainedChildren = subject.children.filter(
    (child) => child.kind === "text" || targetElement(child) === undefined,
  )
  return {
    ...subject,
    attributes: subject.attributes.filter((attribute) => targetName(attribute) === undefined),
    children: retainedChildren.map((child) => (isElement(child) ? cleanSubject(child) : child)),
  }
}

function populateDestination(
  document: XmpDocument,
  inspection: RdfInspection,
  input: IptcWriteValues,
): XmpElement {
  const cleaned = cleanSubject(inspection.destination)
  const namespaces = namespaceScope(document, inspection)
  const iptcPrefix = choosePrefix("Iptc4xmpExt", IPTC_EXTENSION_NAMESPACE, namespaces)
  const rdfPrefix = choosePrefix("rdf", RDF_NAMESPACE, namespaces)
  const version = input.observedVersion?.trim() === "" ? undefined : input.observedVersion
  return {
    ...cleaned,
    attributes: [
      ...cleaned.attributes,
      ...(namespaces.get(iptcPrefix) === IPTC_EXTENSION_NAMESPACE
        ? []
        : [declaration(iptcPrefix, IPTC_EXTENSION_NAMESPACE)]),
      ...(namespaces.get(rdfPrefix) === RDF_NAMESPACE
        ? []
        : [declaration(rdfPrefix, RDF_NAMESPACE)]),
    ],
    children: [
      ...cleaned.children,
      textProperty(iptcPrefix, "AIPromptInformation", input.prompt),
      textProperty(iptcPrefix, "AISystemUsed", input.system),
      ...(version === undefined ? [] : [textProperty(iptcPrefix, "AISystemVersionUsed", version)]),
      sourceProperty(iptcPrefix, rdfPrefix),
    ],
  }
}

export function replaceIptcValues(
  document: XmpDocument,
  input: IptcWriteValues,
): XmpResult<XmpDocument> {
  const inspection = inspectRdf(document)
  if (inspection.kind === "rejected") return inspection
  const rdf = {
    ...inspection.value.rdf,
    children: inspection.value.rdf.children.map((node) => {
      if (!isElement(node)) return node
      return node === inspection.value.destination
        ? populateDestination(document, inspection.value, input)
        : cleanSubject(node)
    }),
  }
  return {
    kind: "ok",
    value: {
      ...document,
      root: {
        ...document.root,
        children: document.root.children.map((node) =>
          node === inspection.value.rdf ? rdf : node,
        ),
      },
    },
  }
}
