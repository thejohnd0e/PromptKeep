// Minimal HTML element-tree parser for fixture files. Test infrastructure
// only; production code never imports it. Supports the subset of HTML used
// by provider fixtures: nested elements, attributes, text nodes.

export type FixtureNode = {
  readonly tag: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: FixtureNode[]
  textContent: string
}

const VOID_TAGS = new Set(["img", "br", "hr", "input", "meta", "link"])

export function parseFixture(html: string): FixtureNode {
  const root: FixtureNode = { tag: "#root", attributes: {}, children: [], textContent: "" }
  const stack: FixtureNode[] = [root]
  const tokenPattern = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\/?>|([^<]+)/gu
  for (;;) {
    const next = tokenPattern.exec(html)
    if (next === null) break
    const [token, tag, attrs, text] = next
    const parent = stack[stack.length - 1]
    if (parent === undefined) break
    if (token.startsWith("<!--")) continue
    if (text !== undefined) {
      parent.textContent += text
      continue
    }
    if (token.startsWith("</")) {
      stack.pop()
      continue
    }
    if (tag === undefined) continue
    const node: FixtureNode = {
      tag: tag.toLowerCase(),
      attributes: parseAttrs(attrs ?? ""),
      children: [],
      textContent: "",
    }
    parent.children.push(node)
    if (!VOID_TAGS.has(node.tag) && !token.endsWith("/>")) {
      stack.push(node)
    }
  }
  return root
}

function parseAttrs(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([a-zA-Z-]+)(?:="([^"]*)")?/gu
  for (;;) {
    const next = pattern.exec(raw)
    if (next === null) break
    const name = next[1]
    if (name === undefined) continue
    attributes[name.toLowerCase()] = next[2] ?? ""
  }
  return attributes
}

// DOM-like query helpers over the fixture tree.

export function queryAll(node: FixtureNode, selector: string): FixtureNode[] {
  const results: FixtureNode[] = []
  for (const child of node.children) {
    if (matches(child, selector)) results.push(child)
    results.push(...queryAll(child, selector))
  }
  return results
}

export function query(node: FixtureNode, selector: string): FixtureNode | undefined {
  return queryAll(node, selector)[0]
}

export function matches(node: FixtureNode, selector: string): boolean {
  for (const part of selector.split(",")) {
    if (matchSimple(node, part.trim())) return true
  }
  return false
}

function matchSimple(node: FixtureNode, selector: string): boolean {
  const tagPattern = /^([a-zA-Z][a-zA-Z0-9-]*)?/
  const attrPattern = /\[([a-zA-Z-]+)([*^]?)=(?:"([^"]*)"|'([^']*)')?\]/gu
  const classPattern = /\.([a-zA-Z0-9_-]+)/gu
  const idPattern = /#([a-zA-Z0-9_-]+)/

  const tagMatch = tagPattern.exec(selector)
  if (tagMatch?.[1] !== undefined && node.tag !== tagMatch[1].toLowerCase()) return false

  for (;;) {
    const next = attrPattern.exec(selector)
    if (next === null) break
    const [, name, op, doubleQuoted, singleQuoted] = next
    if (name === undefined) continue
    const actual = node.attributes[name.toLowerCase()]
    if (actual === undefined) return false
    const value = doubleQuoted ?? singleQuoted
    if (value !== undefined) {
      if (op === "^") {
        if (!actual.startsWith(value)) return false
      } else if (op === "*") {
        if (!actual.includes(value)) return false
      } else if (actual !== value) {
        return false
      }
    }
  }

  for (;;) {
    const next = classPattern.exec(selector)
    if (next === null) break
    const className = next[1]
    if (className === undefined) return false
    const classes = (node.attributes["class"] ?? "").split(/\s+/u)
    if (!classes.includes(className)) return false
  }

  const idMatch = idPattern.exec(selector)
  if (idMatch !== null && node.attributes["id"] !== idMatch[1]) return false

  return true
}

export function fullText(node: FixtureNode): string {
  return node.textContent + node.children.map(fullText).join("")
}

/**
 * DOM-like wrapper over a fixture tree implementing the subset of
 * Element/Document the provider adapters use: querySelector(All), closest,
 * parentElement, getAttribute, textContent.
 */
export class FixtureElement {
  readonly #node: FixtureNode
  readonly parentElement: FixtureElement | null

  constructor(node: FixtureNode, parent: FixtureElement | null) {
    this.#node = node
    this.parentElement = parent
  }

  get textContent(): string {
    return fullText(this.#node)
  }

  getAttribute(name: string): string | null {
    const value = this.#node.attributes[name.toLowerCase()]
    return value === undefined ? null : value
  }

  querySelector(selector: string): FixtureElement | null {
    return (
      queryAll(this.#node, selector)
        .map((child) => this.#wrap(child))
        .find(() => true) ?? null
    )
  }

  querySelectorAll(selector: string): FixtureElement[] {
    return queryAll(this.#node, selector).map((child) => this.#wrap(child))
  }

  closest(selector: string): FixtureElement | null {
    let current: FixtureElement | null = this
    while (current !== null) {
      if (matches(current.#node, selector)) return current
      current = current.parentElement
    }
    return null
  }

  #wrap(node: FixtureNode): FixtureElement {
    return new FixtureElement(node, this)
  }
}

export function parseFixtureDocument(html: string): FixtureElement {
  return new FixtureElement(parseFixture(html), null)
}
