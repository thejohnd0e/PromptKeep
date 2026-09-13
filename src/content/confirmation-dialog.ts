import type { Provider } from "../shared/contracts"

export type AssociationType = "deterministic" | "user_confirmed"

export type ConfirmationDialogConfig = {
  readonly container: HTMLElement
  readonly prompt: string
  readonly provider: Provider
  readonly associationType: AssociationType
  readonly hasC2PA: boolean
  readonly thumbnailUrl?: string
  readonly onConfirm: (acknowledgeC2PA: boolean) => void
  readonly onCancel: () => void
}

export type ConfirmationDialogHandle = {
  readonly dispose: () => void
}

const PROVIDER_LABELS: Record<Provider, string> = {
  chatgpt: "ChatGPT",
  gemini: "Google Gemini",
  grok: "Grok",
}

let dialogIdCounter = 0

function collectFocusable(root: HTMLElement): HTMLElement[] {
  const focusable: HTMLElement[] = []
  const visit = (element: HTMLElement): void => {
    for (const child of Array.from(element.children)) {
      const htmlChild = child as HTMLElement
      if (
        htmlChild.tabIndex >= 0 ||
        htmlChild.tagName === "BUTTON" ||
        htmlChild.tagName === "INPUT"
      ) {
        focusable.push(htmlChild)
      }
      visit(htmlChild)
    }
  }
  visit(root)
  return focusable
}

export function mountConfirmationDialog(
  config: ConfirmationDialogConfig,
): ConfirmationDialogHandle {
  const backdrop = document.createElement("div")
  backdrop.className = "aip2e-dialog-backdrop"

  const dialog = document.createElement("div")
  dialog.className = "aip2e-dialog"
  dialog.setAttribute("role", "dialog")
  dialog.setAttribute("aria-modal", "true")
  dialog.tabIndex = -1

  const titleId = `aip2e-dialog-title-${dialogIdCounter++}`
  const title = document.createElement("h2")
  title.className = "aip2e-dialog-title"
  title.id = titleId
  title.textContent = "Confirm download with prompt"
  dialog.setAttribute("aria-labelledby", titleId)

  const thumbnail = document.createElement("img")
  thumbnail.className = "aip2e-dialog-thumbnail"
  thumbnail.alt = "Image to download"
  if (config.thumbnailUrl !== undefined) {
    thumbnail.setAttribute("src", config.thumbnailUrl)
  }

  const promptLabel = document.createElement("div")
  promptLabel.className = "aip2e-dialog-field-label"
  promptLabel.textContent = "Prompt"

  const promptElement = document.createElement("div")
  promptElement.className = "aip2e-dialog-prompt"
  promptElement.textContent = config.prompt

  const providerElement = document.createElement("div")
  providerElement.className = "aip2e-dialog-provider"
  providerElement.textContent = PROVIDER_LABELS[config.provider]

  const associationElement = document.createElement("div")
  associationElement.className = "aip2e-dialog-association"
  associationElement.textContent =
    config.associationType === "deterministic"
      ? "Deterministic association"
      : "Manual confirmation required"

  const confirmButton = document.createElement("button")
  confirmButton.type = "button"
  confirmButton.className = "aip2e-dialog-confirm"
  confirmButton.textContent = "Download with prompt"
  confirmButton.disabled = config.hasC2PA

  let acknowledgeC2PA = false

  if (config.hasC2PA) {
    const warning = document.createElement("div")
    warning.className = "aip2e-c2pa-warning"
    warning.textContent =
      "This image contains C2PA provenance data. The modified copy may no longer pass C2PA validation."

    const label = document.createElement("label")
    label.className = "aip2e-c2pa-label"
    const checkbox = document.createElement("input")
    checkbox.className = "aip2e-c2pa-checkbox"
    checkbox.type = "checkbox"
    checkbox.addEventListener("change", () => {
      acknowledgeC2PA = checkbox.checked
      confirmButton.disabled = !acknowledgeC2PA
    })
    const labelText = document.createElement("span")
    labelText.textContent = "I understand the modified copy may no longer pass C2PA validation"
    label.appendChild(checkbox)
    label.appendChild(labelText)
    warning.appendChild(label)
    dialog.appendChild(warning)
  }

  const actions = document.createElement("div")
  actions.className = "aip2e-dialog-actions"
  actions.appendChild(confirmButton)

  const cancelButton = document.createElement("button")
  cancelButton.type = "button"
  cancelButton.className = "aip2e-dialog-cancel"
  cancelButton.textContent = "Cancel"
  actions.appendChild(cancelButton)

  dialog.appendChild(title)
  dialog.appendChild(thumbnail)
  dialog.appendChild(promptLabel)
  dialog.appendChild(promptElement)
  dialog.appendChild(providerElement)
  dialog.appendChild(associationElement)
  dialog.appendChild(actions)
  backdrop.appendChild(dialog)

  let disposed = false
  const previouslyFocused = document.activeElement as HTMLElement | null

  const removeFromDom = (): void => {
    if (disposed) {
      return
    }
    disposed = true
    backdrop.remove()
    previouslyFocused?.focus()
  }

  const close = (): void => {
    if (disposed) {
      return
    }
    removeFromDom()
    config.onCancel()
  }

  const confirm = (): void => {
    if (disposed) {
      return
    }
    removeFromDom()
    config.onConfirm(acknowledgeC2PA)
  }

  confirmButton.addEventListener("click", confirm)
  cancelButton.addEventListener("click", close)

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault?.()
      close()
      return
    }
    if (event.key === "Tab") {
      const focusable = collectFocusable(dialog)
      if (focusable.length === 0) {
        return
      }
      const current = document.activeElement
      const currentIndex = focusable.indexOf(current as HTMLElement)
      if (event.shiftKey === true) {
        if (currentIndex <= 0) {
          event.preventDefault?.()
          focusable[focusable.length - 1]?.focus()
        }
      } else if (currentIndex === focusable.length - 1) {
        event.preventDefault?.()
        focusable[0]?.focus()
      }
    }
  })

  config.container.appendChild(backdrop)
  dialog.focus()

  return {
    dispose: removeFromDom,
  }
}
