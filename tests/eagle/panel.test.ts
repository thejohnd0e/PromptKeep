import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderPanel } from "../../eagle-plugin/src/panel"
import type { ReadAiMetadataResult } from "../../eagle-plugin/src/read-ai-metadata"
import { installDomShim, type MockDocument, type MockElement } from "../unit/content-ui/dom-shim"

function callbacks() {
  return { onAnnotate: vi.fn(async () => ({ kind: "success" as const })) }
}

describe("renderPanel", () => {
  let doc: MockDocument
  let container: HTMLElement

  beforeEach(() => {
    doc = installDomShim()
    container = doc.createElement("div") as unknown as HTMLElement
  })

  const presentResult: ReadAiMetadataResult = {
    kind: "present",
    value: {
      prompt: "a cat <script>alert(1)</script> in space",
      system: "ChatGPT",
      systemVersion: "GPT-4o",
      digitalSourceType: "https://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
    },
  }

  function mockEl(element: HTMLElement): MockElement {
    return element as unknown as MockElement
  }

  it("renders collapsible sections for all present fields", () => {
    renderPanel(container, presentResult, callbacks())
    const toggles = mockEl(container).querySelectorAll(".ai-toggle")
    expect(toggles.length).toBe(4)
    const labels = toggles.map((t) => t.textContent)
    expect(labels).toEqual(["Original prompt", "AI system", "Version", "Digital source type"])
  })

  it("omits the version section when version is missing", () => {
    const { systemVersion: _omitted, ...withoutVersion } = presentResult.value
    const result: ReadAiMetadataResult = {
      kind: "present",
      value: withoutVersion,
    }
    renderPanel(container, result, callbacks())
    expect(mockEl(container).querySelectorAll(".ai-toggle").length).toBe(3)
  })

  it("escapes prompt text — no markup injection through textContent", () => {
    renderPanel(container, presentResult, callbacks())
    const values = mockEl(container).querySelectorAll(".ai-field-value")
    expect(values[0]?.textContent).toBe("a cat <script>alert(1)</script> in space")
    // No child elements were created inside the value node.
    expect(values[0]?.children.length).toBe(0)
  })

  it("collapses a section on toggle click", () => {
    renderPanel(container, presentResult, callbacks())
    const toggle = mockEl(container).querySelectorAll(".ai-toggle")[0]
    toggle?.dispatchEvent({ type: "click" })
    expect(toggle?.getAttribute("aria-expanded")).toBe("false")
    toggle?.dispatchEvent({ type: "click" })
    expect(toggle?.getAttribute("aria-expanded")).toBe("true")
  })

  it("renders absent state", () => {
    renderPanel(container, { kind: "absent" }, callbacks())
    const status = mockEl(container).querySelectorAll(".ai-status")
    expect(status.length).toBe(1)
    expect(status[0]?.textContent).toContain("No standard AI prompt metadata")
  })

  it("renders malformed state with the error code", () => {
    renderPanel(
      container,
      { kind: "malformed", error: { code: "PNG_CRC_MISMATCH", chunkType: "IDAT", chunkIndex: 2 } },
      callbacks(),
    )
    const error = mockEl(container).querySelectorAll(".ai-error")
    expect(error.length).toBe(1)
    expect(error[0]?.textContent).toContain("PNG_CRC_MISMATCH")
  })

  it("renders unsupported state with the error code", () => {
    renderPanel(
      container,
      { kind: "unsupported", error: { code: "PNG_UNSUPPORTED_APNG", chunkType: "acTL" } },
      callbacks(),
    )
    const error = mockEl(container).querySelectorAll(".ai-error")
    expect(error.length).toBe(1)
    expect(error[0]?.textContent).toContain("PNG_UNSUPPORTED_APNG")
  })

  it("shows annotate button only for present results", () => {
    renderPanel(container, presentResult, callbacks())
    expect(mockEl(container).querySelectorAll(".ai-annotate").length).toBe(1)
    renderPanel(container, { kind: "absent" }, callbacks())
    expect(mockEl(container).querySelectorAll(".ai-annotate").length).toBe(0)
  })

  it("long Unicode prompt renders exactly", () => {
    const long = "кот 🐈 ".repeat(300)
    renderPanel(
      container,
      { kind: "present", value: { ...presentResult.value, prompt: long } },
      callbacks(),
    )
    const values = mockEl(container).querySelectorAll(".ai-field-value")
    expect(values[0]?.textContent).toBe(long)
  })
})
