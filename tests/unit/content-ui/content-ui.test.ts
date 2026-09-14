import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mountDownloadControl } from "../../../src/content/image-action"
import { mountStatusUI } from "../../../src/content/status-ui"
import { animationsOf, installDomShim, type MockDocument, type MockElement } from "./dom-shim"

let doc: MockDocument

function el(tag: string): HTMLElement {
  return document.createElement(tag) as unknown as HTMLElement
}

function img(src: string): HTMLImageElement {
  const element = document.createElement("img") as unknown as HTMLImageElement
  element.setAttribute("src", src)
  return element
}

function fire(
  element: HTMLElement | null | undefined,
  type: string,
  key?: string,
  shiftKey?: boolean,
): void {
  if (element === null || element === undefined) {
    return
  }
  ;(element as unknown as MockElement).dispatchEvent({
    type,
    ...(key === undefined ? {} : { key }),
    ...(shiftKey === undefined ? {} : { shiftKey }),
    preventDefault: () => {},
    stopPropagation: () => {},
  })
}

function mountToBody(element: HTMLElement): void {
  doc.body.appendChild(element as unknown as MockElement)
}

function buttonOf(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector(".aip2e-download-button") as HTMLButtonElement | null
}

function controlOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector(".aip2e-control") as HTMLElement | null
}

function dialogOf(doc: MockDocument): HTMLElement | null {
  return doc.body.querySelector(".aip2e-dialog") as HTMLElement | null
}

function mountConfig(overrides: Partial<Parameters<typeof mountDownloadControl>[0]> = {}) {
  return {
    container: el("div"),
    imageElement: img("https://example.com/a.png"),
    label: "Download with prompt",
    provider: "chatgpt" as const,
    prompt: "a serene mountain lake at dawn",
    associationType: "deterministic" as const,
    onRequest: vi.fn(),
    ...overrides,
  }
}

describe("mountDownloadControl", () => {
  beforeEach(() => {
    doc = installDomShim()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("renders an accessible, focusable button beside the image", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)

    const handle = mountDownloadControl(config)

    const button = buttonOf(config.container)
    expect(button).not.toBeNull()
    expect(button?.tagName).toBe("BUTTON")
    expect(button?.textContent).toBe("A")
    expect(button?.getAttribute("aria-label")).toBe("Download with prompt")
    expect(button?.title).toBe("Download with prompt")
    expect(button?.tabIndex).toBe(0)
    expect(button?.type).toBe("button")
    expect(handle.dispose).toBeTypeOf("function")
  })

  it("places the control at the top-right of the image", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)

    mountDownloadControl(config)

    const control = controlOf(config.container)
    expect(control).not.toBeNull()
    if (control === null) return
    expect(control.style.top).toBe("8px")
    expect(control.style.right).toBe("8px")
  })

  it("hides the control until the image is hovered", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)

    mountDownloadControl(config)

    const control = controlOf(config.container)
    expect(control).not.toBeNull()
    if (control === null) return
    expect(control.style.opacity).toBe("0")

    fire(config.container, "mouseenter")
    expect(control.style.opacity).toBe("1")

    fire(config.container, "mouseleave")
    expect(control.style.opacity).toBe("0")
  })

  it("starts the download immediately on click without a confirmation dialog", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    mountDownloadControl(config)

    fire(buttonOf(config.container), "click")

    expect(config.onRequest).toHaveBeenCalledOnce()
    expect(dialogOf(doc)).toBeNull()
  })

  it("spins the button once on click", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    mountDownloadControl(config)
    const button = buttonOf(config.container)

    fire(button, "click")

    expect(animationsOf(button)).toHaveLength(1)
    expect(animationsOf(button)[0]?.keyframes).toEqual([
      { transform: "rotate(0deg)" },
      { transform: "rotate(360deg)" },
    ])
  })

  it("spins the button once on keyboard activation", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    mountDownloadControl(config)
    const button = buttonOf(config.container)

    fire(button, "keydown", "Enter")

    expect(animationsOf(button)).toHaveLength(1)
  })

  it("consumes pointer and click events without starting duplicate downloads", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    mountDownloadControl(config)
    const button = doc.body.querySelector(".aip2e-download-button")
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()

    button?.dispatchEvent({ type: "pointerdown", preventDefault, stopPropagation })
    button?.dispatchEvent({ type: "mousedown", preventDefault, stopPropagation })
    button?.dispatchEvent({ type: "click", preventDefault, stopPropagation })

    expect(preventDefault).toHaveBeenCalledTimes(3)
    expect(stopPropagation).toHaveBeenCalledTimes(3)
    expect(config.onRequest).toHaveBeenCalledOnce()
  })

  it("keeps the control non-interactive while hidden so it never blocks the image", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)

    mountDownloadControl(config)

    const control = controlOf(doc.body as unknown as HTMLElement)
    expect(control?.style.pointerEvents).toBe("none")

    fire(config.container, "mouseenter")
    expect(control?.style.pointerEvents).toBe("auto")
  })

  it("starts the download on Enter and Space keys", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    mountDownloadControl(config)

    fire(buttonOf(config.container), "keydown", "Enter")
    expect(config.onRequest).toHaveBeenCalledWith({
      prompt: "a serene mountain lake at dawn",
      provider: "chatgpt",
      associationType: "deterministic",
      acknowledgeC2PA: true,
    })

    fire(buttonOf(config.container), "keydown", " ")
    expect(config.onRequest).toHaveBeenCalledTimes(2)
  })

  it("prevents duplicate controls for the same image", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)

    const first = mountDownloadControl(config)
    const second = mountDownloadControl(config)

    expect(second).toBe(first)
    expect(config.container.querySelectorAll(".aip2e-download-button")).toHaveLength(1)
  })

  it("dispose removes the control and re-mount leaves exactly one control", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)

    const handle = mountDownloadControl(config)
    handle.dispose()
    expect(buttonOf(config.container)).toBeNull()

    mountDownloadControl(config)
    expect(config.container.querySelectorAll(".aip2e-download-button")).toHaveLength(1)
  })

  it("only the explicitly selected image becomes ready", () => {
    const container = el("div")
    const imageA = img("https://example.com/a.png")
    const imageB = img("https://example.com/b.png")
    container.appendChild(imageA)
    container.appendChild(imageB)
    mountToBody(container)

    const onRequestA = vi.fn()
    const onRequestB = vi.fn()
    const handleA = mountDownloadControl(
      mountConfig({ container, imageElement: imageA, onRequest: onRequestA }),
    )
    const handleB = mountDownloadControl(
      mountConfig({ container, imageElement: imageB, onRequest: onRequestB }),
    )

    handleA.setReady(true)
    handleB.setReady(false)

    const buttons = container.querySelectorAll(".aip2e-download-button")
    expect(buttons).toHaveLength(2)
    const buttonA = buttons[0] as HTMLButtonElement | undefined
    const buttonB = buttons[1] as HTMLButtonElement | undefined
    expect(buttonA?.disabled).toBe(false)
    expect(buttonB?.disabled).toBe(true)

    fire(buttonB ?? null, "click")
    expect(onRequestB).not.toHaveBeenCalled()

    fire(buttonA ?? null, "click")
    expect(onRequestA).toHaveBeenCalledOnce()
  })

  it("setPrompt updates the prompt used for the download", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    const handle = mountDownloadControl(config)

    handle.setPrompt("a revised prompt")
    fire(buttonOf(config.container), "click")

    expect(config.onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "a revised prompt" }),
    )
  })

  it("passes a hostile prompt as inert data to the callback", () => {
    const hostilePrompt = '<img src=x onerror="alert(1)">'
    const config = mountConfig({ prompt: hostilePrompt })
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    mountDownloadControl(config)

    fire(buttonOf(config.container), "click")

    expect(config.onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: hostilePrompt }),
    )
    const executableImages = doc.body
      .querySelectorAll("img")
      .filter((node) => node.getAttribute("onerror") !== null)
    expect(executableImages).toHaveLength(0)
  })
})

describe("mountStatusUI", () => {
  beforeEach(() => {
    doc = installDomShim()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("renders a stable code and safe message with alert role for errors", () => {
    const container = el("div")
    mountToBody(container)

    mountStatusUI({
      container,
      code: "ASSOCIATION_AMBIGUOUS",
      message: "Multiple images match this prompt. Select one to continue.",
      level: "error",
    })

    const status = container.querySelector(".aip2e-status")
    expect(status).not.toBeNull()
    expect(status?.getAttribute("role")).toBe("alert")
    expect(status?.querySelector(".aip2e-status-code")?.textContent).toBe("ASSOCIATION_AMBIGUOUS")
    expect(status?.querySelector(".aip2e-status-message")?.textContent).toBe(
      "Multiple images match this prompt. Select one to continue.",
    )
  })

  it("uses status role for non-error levels", () => {
    const container = el("div")
    mountToBody(container)

    mountStatusUI({
      container,
      code: "OPERATION_STARTED",
      message: "Download started.",
      level: "info",
    })

    expect(container.querySelector(".aip2e-status")?.getAttribute("role")).toBe("status")
  })

  it("escapes hostile message text", () => {
    const container = el("div")
    mountToBody(container)
    const hostile = '<img src=x onerror="alert(1)">'

    mountStatusUI({ container, code: "E", message: hostile, level: "error" })

    const status = container.querySelector(".aip2e-status")
    expect(status?.querySelector(".aip2e-status-message")?.textContent).toBe(hostile)
    const executableImages = doc.body
      .querySelectorAll("img")
      .filter((node) => node.getAttribute("onerror") !== null)
    expect(executableImages).toHaveLength(0)
  })

  it("dispose removes the status element", () => {
    const container = el("div")
    mountToBody(container)

    const handle = mountStatusUI({
      container,
      code: "E",
      message: "m",
      level: "error",
    })
    handle.dispose()

    expect(container.querySelector(".aip2e-status")).toBeNull()
  })

  it("update changes code, message, and level", () => {
    const container = el("div")
    mountToBody(container)

    const handle = mountStatusUI({
      container,
      code: "E",
      message: "m",
      level: "error",
    })
    handle.update({ code: "OPERATION_COMPLETED", message: "done", level: "success" })

    const status = container.querySelector(".aip2e-status")
    expect(status?.querySelector(".aip2e-status-code")?.textContent).toBe("OPERATION_COMPLETED")
    expect(status?.querySelector(".aip2e-status-message")?.textContent).toBe("done")
    expect(status?.getAttribute("role")).toBe("status")
  })
})
