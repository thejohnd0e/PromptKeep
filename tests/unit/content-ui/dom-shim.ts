import { vi } from "vitest"

// Minimal DOM shim for testing the content UI layer without a jsdom dependency.
// Provides just enough of the DOM API (elements, attributes, events, focus,
// querying) for the UI modules and their tests to run under the node
// environment. This is test infrastructure only; production code never imports
// it.

export type MockEvent = {
  readonly type: string
  readonly key?: string
  readonly shiftKey?: boolean
  readonly target?: MockElement
  readonly preventDefault?: () => void
  readonly stopPropagation?: () => void
}

export type MockAnimation = {
  readonly keyframes: unknown
  readonly options: unknown
}

const animationLog = new WeakMap<object, MockAnimation[]>()

/** Reads the animations a shim element was asked to play, without casting. */
export function animationsOf(element: object | null | undefined): readonly MockAnimation[] {
  if (element === null || element === undefined) return []
  return animationLog.get(element) ?? []
}

export class MockElement {
  readonly tagName: string
  readonly children: MockElement[] = []
  parentElement: MockElement | null = null
  textContent = ""
  style: Record<string, string> = {}
  disabled = false
  checked = false
  type = ""
  value = ""
  tabIndex = -1
  private readonly attributes = new Map<string, string>()
  private readonly listeners = new Map<string, Set<(event: MockEvent) => void>>()

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase()
  }

  get className(): string {
    return this.attributes.get("class") ?? ""
  }

  set className(value: string) {
    this.attributes.set("class", value)
  }

  get id(): string {
    return this.attributes.get("id") ?? ""
  }

  set id(value: string) {
    this.attributes.set("id", value)
  }

  get src(): string {
    return this.attributes.get("src") ?? ""
  }

  set src(value: string) {
    this.attributes.set("src", value)
  }

  get classList(): {
    add: (name: string) => void
    remove: (name: string) => void
    contains: (name: string) => boolean
  } {
    return {
      add: (name: string) => {
        const classes = this.className.split(/\s+/u).filter((entry) => entry !== "")
        if (!classes.includes(name)) {
          classes.push(name)
        }
        this.className = classes.join(" ")
      },
      remove: (name: string) => {
        this.className = this.className
          .split(/\s+/u)
          .filter((entry) => entry !== name)
          .join(" ")
      },
      contains: (name: string) => this.className.split(/\s+/u).includes(name),
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  getAttributeNames(): string[] {
    return [...this.attributes.keys()]
  }

  appendChild(child: MockElement): MockElement {
    child.remove()
    this.children.push(child)
    child.parentElement = this
    return child
  }

  removeChild(child: MockElement): MockElement {
    const index = this.children.indexOf(child)
    if (index >= 0) {
      this.children.splice(index, 1)
    }
    child.parentElement = null
    return child
  }

  remove(): void {
    this.parentElement?.removeChild(this)
  }

  replaceChildren(...children: MockElement[]): void {
    for (const child of this.children) {
      child.parentElement = null
    }
    this.children.length = 0
    for (const child of children) {
      this.appendChild(child)
    }
  }

  addEventListener(type: string, handler: (event: MockEvent) => void): void {
    const handlers = this.listeners.get(type) ?? new Set()
    handlers.add(handler)
    this.listeners.set(type, handlers)
  }

  removeEventListener(type: string, handler: (event: MockEvent) => void): void {
    this.listeners.get(type)?.delete(handler)
  }

  dispatchEvent(event: MockEvent): boolean {
    const handlers = this.listeners.get(event.type)
    if (handlers === undefined) {
      return true
    }
    for (const handler of [...handlers]) {
      handler({ ...event, target: event.target ?? this })
    }
    return true
  }

  click(): void {
    this.dispatchEvent({ type: "click" })
  }

  focus(): void {
    ;(document as unknown as MockDocument).activeElement = this
  }

  animate(keyframes: unknown, options?: unknown): void {
    const existing = animationLog.get(this) ?? []
    existing.push({ keyframes, options })
    animationLog.set(this, existing)
  }

  getBoundingClientRect(): {
    top: number
    left: number
    width: number
    height: number
    right: number
    bottom: number
  } {
    return { top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100 }
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = []
    for (const child of this.children) {
      if (matchesSelector(child, selector)) {
        results.push(child)
      }
      results.push(...child.querySelectorAll(selector))
    }
    return results
  }
}

function matchesSelector(element: MockElement, selector: string): boolean {
  if (selector.startsWith(".")) {
    return element.classList.contains(selector.slice(1))
  }
  if (selector.startsWith("#")) {
    return element.id === selector.slice(1)
  }
  return element.tagName.toLowerCase() === selector.toLowerCase()
}

export class MockDocument {
  readonly body = new MockElement("body")
  readonly documentElement = new MockElement("html")
  activeElement: MockElement | null = null
  readonly defaultView = {
    setTimeout: (handler: () => void, timeout: number) => setTimeout(handler, timeout),
    clearTimeout: (timeoutId: ReturnType<typeof setTimeout>) => clearTimeout(timeoutId),
  }

  createElement(tagName: string): MockElement {
    return new MockElement(tagName)
  }
}

class MockMutationObserver {
  observe(): void {}

  disconnect(): void {}
}

export function installDomShim(): MockDocument {
  const doc = new MockDocument()
  doc.documentElement.appendChild(doc.body)
  vi.stubGlobal("document", doc)
  vi.stubGlobal("Element", MockElement)
  vi.stubGlobal("HTMLElement", MockElement)
  vi.stubGlobal("HTMLImageElement", MockElement)
  vi.stubGlobal("HTMLButtonElement", MockElement)
  vi.stubGlobal("MutationObserver", MockMutationObserver)
  return doc
}
