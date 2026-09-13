import { appendPromptAnnotation } from "./annotation-action"
import {
  type EagleApi,
  type EagleItem,
  ensureSinglePngSelection,
  getSelectedItems,
  type SelectionState,
} from "./eagle-api"
import { renderPanel } from "./panel"
import { readAiMetadata } from "./read-ai-metadata"

export type RenderState = SelectionState

export async function resolveSelection(eagle: EagleApi): Promise<RenderState> {
  const items = await getSelectedItems(eagle)
  return ensureSinglePngSelection(items)
}

export function createInspector(eagle: EagleApi, render: (state: RenderState) => void): void {
  const refresh = async (): Promise<void> => {
    const state = await resolveSelection(eagle)
    render(state)
    if (state.kind === "single_png") {
      await renderSelectedMetadata(eagle, state.filePath)
    }
  }
  eagle.item.onChange(() => {
    void refresh()
  })
  void refresh()
}

/**
 * Resolves the selected Eagle item matching the rendered selection state and
 * renders its AI metadata panel. Annotation is never triggered here — only
 * the panel button click saves.
 */
async function renderSelectedMetadata(eagle: EagleApi, filePath: string): Promise<void> {
  const items = await getSelectedItems(eagle)
  const item = items.find((candidate) => candidate.filePath === filePath)
  if (item === undefined || typeof document === "undefined") {
    return
  }
  const panel = document.querySelector<HTMLElement>("#inspector-panel")
  if (panel === null) {
    return
  }
  await renderMetadataPanel(item, panel)
}

export function renderState(state: RenderState): void {
  const panel = document.querySelector<HTMLElement>("#inspector-panel")
  if (panel === null) {
    return
  }
  panel.replaceChildren()
  const status = document.createElement("p")
  status.className = "inspector-status"
  status.textContent = statusText(state)
  panel.appendChild(status)
}

/**
 * Full inspector refresh for a confirmed single-PNG selection: reads the file
 * bytes through the item's fileURL, parses AI metadata, and renders the panel.
 * Annotation is never triggered here — only the panel button click saves.
 */
export async function renderMetadataPanel(item: EagleItem, container: Element): Promise<void> {
  let result: ReturnType<typeof readAiMetadata>
  try {
    const response = await fetch(item.fileURL)
    if (!response.ok) {
      result = { kind: "malformed", error: { code: "XMP_UNSAFE_XML" } }
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer())
      result = readAiMetadata(bytes)
    }
  } catch {
    result = { kind: "malformed", error: { code: "XMP_UNSAFE_XML" } }
  }
  renderPanel(container, result, {
    onAnnotate: () =>
      appendPromptAnnotation(item, result.kind === "present" ? result.value.prompt : ""),
  })
}

function statusText(state: RenderState): string {
  switch (state.kind) {
    case "single_png":
      return `Selected PNG: ${state.filePath}`
    case "empty":
      return state.reason
    case "unsupported":
      return state.reason
  }
}
