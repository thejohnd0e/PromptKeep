import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mountDownloadControl } from "../../../src/content/image-action"
import { mountStatusUI } from "../../../src/content/status-ui"
import { installDomShim, type MockDocument, type MockElement } from "./dom-shim"

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
  })
}

function mountToBody(element: HTMLElement): void {
  doc.body.appendChild(element as unknown as MockElement)
}

function buttonOf(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector(".aip2e-download-button") as HTMLButtonElement | null
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
    expect(button?.textContent).toBe("Download with prompt")
    expect(button?.getAttribute("aria-label")).toBe("Download with prompt")
    expect(button?.tabIndex).toBe(0)
    expect(button?.type).toBe("button")
    expect(handle.dispose).toBeTypeOf("function")
  })

  it("opens the confirmation dialog on click", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    mountDownloadControl(config)

    fire(buttonOf(config.container), "click")

    const dialog = dialogOf(doc)
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute("role")).toBe("dialog")
    expect(dialog?.getAttribute("aria-modal")).toBe("true")
    expect(dialog?.getAttribute("aria-labelledby")).not.toBeNull()
  })

  it("opens the confirmation dialog on Enter and Space keys", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    mountDownloadControl(config)

    fire(buttonOf(config.container), "keydown", "Enter")
    expect(dialogOf(doc)).not.toBeNull()

    fire(dialogOf(doc)?.querySelector(".aip2e-dialog-cancel"), "click")

    fire(buttonOf(config.container), "keydown", " ")
    expect(dialogOf(doc)).not.toBeNull()
  })

  it("moves focus into the dialog on open and back to the button on close", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    mountDownloadControl(config)

    fire(buttonOf(config.container), "click")
    expect(doc.activeElement).toBe(dialogOf(doc))

    fire(dialogOf(doc)?.querySelector(".aip2e-dialog-cancel"), "click")
    expect(doc.activeElement).toBe(buttonOf(config.container))
  })

  it("traps focus within the dialog on Tab", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    mountDownloadControl(config)

    fire(buttonOf(config.container), "click")
    const dialog = dialogOf(doc)
    const confirmButton = dialog?.querySelector(".aip2e-dialog-confirm") as HTMLButtonElement | null
    const cancelButton = dialog?.querySelector(".aip2e-dialog-cancel") as HTMLButtonElement | null
    expect(confirmButton).not.toBeNull()
    expect(cancelButton).not.toBeNull()

    cancelButton?.focus()
    fire(dialog, "keydown", "Tab")
    expect(doc.activeElement).toBe(confirmButton)

    confirmButton?.focus()
    fire(dialog, "keydown", "Tab", true)
    expect(doc.activeElement).toBe(cancelButton)
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

  it("dispose closes an open dialog and removes its DOM", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)

    const handle = mountDownloadControl(config)
    fire(buttonOf(config.container), "click")
    expect(dialogOf(doc)).not.toBeNull()

    handle.dispose()
    expect(dialogOf(doc)).toBeNull()
    expect(buttonOf(config.container)).toBeNull()
  })

  it("shows the full prompt, provider, and thumbnail in the dialog", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    mountDownloadControl(config)

    fire(buttonOf(config.container), "click")
    const dialog = dialogOf(doc)

    expect(dialog?.querySelector(".aip2e-dialog-prompt")?.textContent).toBe(
      "a serene mountain lake at dawn",
    )
    expect(dialog?.querySelector(".aip2e-dialog-provider")?.textContent).toContain("ChatGPT")
    expect(dialog?.querySelector(".aip2e-dialog-thumbnail")?.getAttribute("src")).toBe(
      "https://example.com/a.png",
    )
  })

  it("labels deterministic association in the dialog", () => {
    const config = mountConfig({ associationType: "deterministic" })
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    mountDownloadControl(config)

    fire(buttonOf(config.container), "click")
    expect(dialogOf(doc)?.querySelector(".aip2e-dialog-association")?.textContent).toContain(
      "Deterministic",
    )
  })

  it("labels user-confirmed association in the dialog", () => {
    const config = mountConfig({ associationType: "user_confirmed" })
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    mountDownloadControl(config)

    fire(buttonOf(config.container), "click")
    expect(dialogOf(doc)?.querySelector(".aip2e-dialog-association")?.textContent).toContain(
      "Manual confirmation",
    )
  })

  it("confirms the download with the exact prompt and association", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    mountDownloadControl(config)

    fire(buttonOf(config.container), "click")
    fire(dialogOf(doc)?.querySelector(".aip2e-dialog-confirm"), "click")

    expect(config.onRequest).toHaveBeenCalledWith({
      prompt: "a serene mountain lake at dawn",
      provider: "chatgpt",
      associationType: "deterministic",
      acknowledgeC2PA: false,
    })
    expect(dialogOf(doc)).toBeNull()
  })

  it("cancels the download and calls onCancel", () => {
    const onCancel = vi.fn()
    const config = mountConfig({ onCancel })
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    mountDownloadControl(config)

    fire(buttonOf(config.container), "click")
    fire(dialogOf(doc)?.querySelector(".aip2e-dialog-cancel"), "click")

    expect(onCancel).toHaveBeenCalledOnce()
    expect(config.onRequest).not.toHaveBeenCalled()
    expect(dialogOf(doc)).toBeNull()
  })

  it("closes the dialog on Escape and calls onCancel", () => {
    const onCancel = vi.fn()
    const config = mountConfig({ onCancel })
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    mountDownloadControl(config)

    fire(buttonOf(config.container), "click")
    fire(dialogOf(doc), "keydown", "Escape")

    expect(onCancel).toHaveBeenCalledOnce()
    expect(dialogOf(doc)).toBeNull()
  })

  it("requires C2PA acknowledgement when caBX is detected", () => {
    const config = mountConfig({ hasC2PA: true })
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    mountDownloadControl(config)

    fire(buttonOf(config.container), "click")
    const dialog = dialogOf(doc)

    expect(dialog?.querySelector(".aip2e-c2pa-warning")).not.toBeNull()
    const confirmButton = dialog?.querySelector(".aip2e-dialog-confirm") as HTMLButtonElement | null
    expect(confirmButton?.disabled).toBe(true)

    const checkbox = dialog?.querySelector(".aip2e-c2pa-checkbox") as HTMLInputElement | null
    expect(checkbox).not.toBeNull()
    if (checkbox === null) {
      throw new Error("expected C2PA acknowledgement checkbox")
    }
    checkbox.checked = true
    fire(checkbox, "change")

    expect(confirmButton?.disabled).toBe(false)
    fire(confirmButton, "click")
    expect(config.onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ acknowledgeC2PA: true }),
    )
  })

  it("does not require C2PA acknowledgement when caBX is absent", () => {
    const config = mountConfig({ hasC2PA: false })
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    mountDownloadControl(config)

    fire(buttonOf(config.container), "click")
    const dialog = dialogOf(doc)

    expect(dialog?.querySelector(".aip2e-c2pa-warning")).toBeNull()
    const confirmButton = dialog?.querySelector(".aip2e-dialog-confirm") as HTMLButtonElement | null
    expect(confirmButton?.disabled).toBe(false)
  })

  it("renders a hostile prompt as text without creating executable nodes", () => {
    const hostilePrompt = '<img src=x onerror="alert(1)">'
    const config = mountConfig({ prompt: hostilePrompt })
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    mountDownloadControl(config)

    fire(buttonOf(config.container), "click")
    const dialog = dialogOf(doc)

    expect(dialog?.querySelector(".aip2e-dialog-prompt")?.textContent).toBe(hostilePrompt)

    const executableImages = doc.body
      .querySelectorAll("img")
      .filter((node) => node.getAttribute("onerror") !== null)
    expect(executableImages).toHaveLength(0)

    fire(dialog?.querySelector(".aip2e-dialog-confirm"), "click")
    expect(config.onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: hostilePrompt }),
    )
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
    expect(dialogOf(doc)).toBeNull()
    expect(onRequestB).not.toHaveBeenCalled()

    fire(buttonA ?? null, "click")
    expect(dialogOf(doc)).not.toBeNull()
  })

  it("setPrompt updates the prompt used for the download", () => {
    const config = mountConfig()
    config.container.appendChild(config.imageElement)
    mountToBody(config.container)
    const handle = mountDownloadControl(config)

    handle.setPrompt("a revised prompt")
    fire(buttonOf(config.container), "click")
    fire(dialogOf(doc)?.querySelector(".aip2e-dialog-confirm"), "click")

    expect(config.onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "a revised prompt" }),
    )
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
