import type { ReadAiMetadataResult } from "./read-ai-metadata"

export type PanelCallbacks = {
  readonly onAnnotate: () => Promise<{ kind: "success" } | { kind: "error"; reason: string }>
}

const FIELD_LABELS = [
  { key: "prompt", label: "Original prompt" },
  { key: "system", label: "AI system" },
  { key: "systemVersion", label: "Version" },
  { key: "digitalSourceType", label: "Digital source type" },
] as const

/**
 * Renders the AI metadata panel into the given container. All dynamic text is
 * assigned through textContent so prompt content can never inject markup.
 */
export function renderPanel(
  container: Element,
  result: ReadAiMetadataResult,
  callbacks: PanelCallbacks,
): void {
  container.replaceChildren()
  if (result.kind === "present") {
    renderPresent(container, result, callbacks)
    return
  }
  renderStateMessage(container, result)
}

function renderPresent(
  container: Element,
  result: Extract<ReadAiMetadataResult, { kind: "present" }>,
  callbacks: PanelCallbacks,
): void {
  const { value } = result
  for (const field of FIELD_LABELS) {
    const text = value[field.key]
    if (text === undefined) continue
    container.appendChild(createSection(field.label, text))
  }
  container.appendChild(createAnnotateButton(callbacks))
}

function createSection(label: string, text: string): Element {
  const section = document.createElement("section")
  section.className = "ai-section"

  const toggle = document.createElement("button")
  toggle.type = "button"
  toggle.className = "ai-toggle"
  toggle.setAttribute("aria-expanded", "true")
  toggle.textContent = label

  const body = document.createElement("div")
  body.className = "ai-section-body"
  const pre = document.createElement("pre")
  pre.className = "ai-field-value"
  pre.textContent = text
  body.appendChild(pre)

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true"
    toggle.setAttribute("aria-expanded", expanded ? "false" : "true")
    body.style.display = expanded ? "none" : "block"
  })

  section.appendChild(toggle)
  section.appendChild(body)
  return section
}

function createAnnotateButton(callbacks: PanelCallbacks): Element {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "ai-annotate"
  button.textContent = "Copy prompt to annotation"
  button.addEventListener("click", () => {
    void handleAnnotate(button, callbacks)
  })
  return button
}

async function handleAnnotate(button: Element, callbacks: PanelCallbacks): Promise<void> {
  const result = await callbacks.onAnnotate()
  const status = document.createElement("p")
  status.className = result.kind === "success" ? "ai-status" : "ai-error"
  status.setAttribute("role", "status")
  status.textContent = result.kind === "success" ? "Prompt copied to annotation." : result.reason
  button.parentElement?.appendChild(status)
}

function renderStateMessage(
  container: Element,
  result: Exclude<ReadAiMetadataResult, { kind: "present" }>,
): void {
  const message = document.createElement("p")
  message.className = result.kind === "absent" ? "ai-status" : "ai-error"
  message.textContent = stateText(result)
  container.appendChild(message)
}

function stateText(result: Exclude<ReadAiMetadataResult, { kind: "present" }>): string {
  switch (result.kind) {
    case "absent":
      return "No standard AI prompt metadata found in this PNG."
    case "malformed":
      return `Metadata is malformed (${result.error.code}).`
    case "unsupported":
      return `Metadata cannot be read (${result.error.code}).`
  }
}
