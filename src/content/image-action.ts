import type { Provider } from "../shared/contracts"
import {
  type AssociationType,
  type ConfirmationDialogConfig,
  type ConfirmationDialogHandle,
  mountConfirmationDialog,
} from "./confirmation-dialog"

export type DownloadRequest = {
  readonly prompt: string
  readonly provider: Provider
  readonly associationType: AssociationType
  readonly acknowledgeC2PA: boolean
}

export type DownloadControlConfig = {
  readonly container: HTMLElement
  readonly imageElement: HTMLElement
  readonly label: string
  readonly provider: Provider
  readonly prompt: string
  readonly associationType: AssociationType
  readonly hasC2PA?: boolean
  readonly onRequest: (request: DownloadRequest) => void
  readonly onCancel?: () => void
}

export type DownloadControlHandle = {
  readonly dispose: () => void
  readonly setPrompt: (prompt: string) => void
  readonly setReady: (ready: boolean) => void
}

const mountedControls = new WeakMap<HTMLElement, DownloadControlHandle>()

export function mountDownloadControl(config: DownloadControlConfig): DownloadControlHandle {
  const existing = mountedControls.get(config.imageElement)
  if (existing !== undefined) {
    return existing
  }

  const control = document.createElement("div")
  control.className = "aip2e-control"

  const button = document.createElement("button")
  button.type = "button"
  button.className = "aip2e-download-button"
  button.textContent = config.label
  button.setAttribute("aria-label", config.label)
  button.tabIndex = 0

  let prompt = config.prompt
  let ready = true
  let dialogHandle: ConfirmationDialogHandle | null = null

  const openDialog = (): void => {
    if (!ready || dialogHandle !== null) {
      return
    }
    button.focus()
    const imageSrc = (config.imageElement as HTMLImageElement).src
    const dialogConfig: ConfirmationDialogConfig = {
      container: document.body,
      prompt,
      provider: config.provider,
      associationType: config.associationType,
      hasC2PA: config.hasC2PA ?? false,
      ...(imageSrc === "" ? {} : { thumbnailUrl: imageSrc }),
      onConfirm: (acknowledgeC2PA) => {
        dialogHandle = null
        config.onRequest({
          prompt,
          provider: config.provider,
          associationType: config.associationType,
          acknowledgeC2PA,
        })
      },
      onCancel: () => {
        dialogHandle = null
        config.onCancel?.()
      },
    }
    dialogHandle = mountConfirmationDialog(dialogConfig)
  }

  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault?.()
      openDialog()
    }
  }

  button.addEventListener("click", openDialog)
  button.addEventListener("keydown", handleKeydown)

  control.appendChild(button)
  config.container.appendChild(control)

  const handle: DownloadControlHandle = {
    dispose: () => {
      mountedControls.delete(config.imageElement)
      dialogHandle?.dispose()
      dialogHandle = null
      button.removeEventListener("click", openDialog)
      button.removeEventListener("keydown", handleKeydown)
      control.remove()
    },
    setPrompt: (nextPrompt) => {
      prompt = nextPrompt
    },
    setReady: (nextReady) => {
      ready = nextReady
      button.disabled = !nextReady
    },
  }

  mountedControls.set(config.imageElement, handle)
  return handle
}
