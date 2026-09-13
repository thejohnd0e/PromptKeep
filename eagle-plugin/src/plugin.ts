import {
  type EagleApi,
  ensureSinglePngSelection,
  getSelectedItems,
  type SelectionState,
} from "./eagle-api"

export type RenderState = SelectionState

export async function resolveSelection(eagle: EagleApi): Promise<RenderState> {
  const items = await getSelectedItems(eagle)
  return ensureSinglePngSelection(items)
}

export function createInspector(eagle: EagleApi, render: (state: RenderState) => void): void {
  const refresh = async (): Promise<void> => {
    render(await resolveSelection(eagle))
  }
  eagle.item.onChange(() => {
    void refresh()
  })
  void refresh()
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
