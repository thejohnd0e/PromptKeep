import { readFile } from "node:fs/promises"
import type { XmpElement, XmpNode } from "../../../src/metadata/xmp-reader"

const FIXTURE_DIRECTORY = new URL("../../fixtures/xmp/", import.meta.url)

export function encodeXmp(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

export function loadXmpFixture(name: string): Promise<Uint8Array> {
  return readFile(new URL(name, FIXTURE_DIRECTORY))
}

export function elementText(element: XmpElement): string {
  return element.children
    .map((child) => (child.kind === "text" ? child.value : elementText(child)))
    .join("")
}

export function findElements(
  node: XmpNode,
  namespaceUri: string,
  localName: string,
): readonly XmpElement[] {
  if (node.kind === "text") return []
  const descendants = node.children.flatMap((child) => findElements(child, namespaceUri, localName))
  return node.name.uri === namespaceUri && node.name.local === localName
    ? [node, ...descendants]
    : descendants
}
