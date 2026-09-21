import type { Provider } from "../shared/contracts"
import type { AssociationType } from "./confirmation-dialog"
import type { ProviderAction } from "../providers/types"
import buttonImageUrl from "./button-new.png?inline"

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
  readonly onRequest: (request: DownloadRequest) => void
  readonly actions?: readonly ProviderAction[]
  readonly onAction?: (action: ProviderAction) => Promise<void>
}

export type DownloadControlHandle = {
  readonly dispose: () => void
  readonly setPrompt: (prompt: string) => void
  readonly setReady: (ready: boolean) => void
}

const mountedControls = new WeakMap<HTMLElement, DownloadControlHandle>()

const SPIN_DURATION_MILLISECONDS = 600

/** One full clockwise rotation as click feedback; safe to replay mid-spin. */
function spinButton(button: HTMLButtonElement): void {
  button.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], {
    duration: SPIN_DURATION_MILLISECONDS,
    easing: "ease-in-out",
  })
}

export function mountDownloadControl(config: DownloadControlConfig): DownloadControlHandle {
  const existing = mountedControls.get(config.imageElement)
  if (existing !== undefined) {
    return existing
  }

  // The control is an overlay pinned inside the image card. The card is the
  // image's parent; when the host page has not positioned it, make it the
  // positioning context so the overlay stays within the image bounds instead
  // of anchoring to the viewport.
  if (config.imageElement.offsetParent !== config.container) {
    config.container.style.position = "relative"
  }

  const control = document.createElement("div")
  control.className = "aip2e-control"
  control.style.position = "absolute"
  control.style.zIndex = "2147483647"
  if (config.provider === "chatgpt") {
    control.style.top = "56px"
    control.style.right = "8px"
  } else if (config.provider === "gemini") {
    control.style.top = "44px"
    control.style.right = "8px"
  } else {
    control.style.top = "8px"
    control.style.right = "8px"
  }
  control.style.opacity = "0"
  control.style.pointerEvents = "none"
  control.style.transition = "opacity 120ms ease"

  const button = document.createElement("button")
  button.type = "button"
  button.className = "aip2e-download-button"
  button.setAttribute("aria-label", config.label)
  button.title = config.label
  button.tabIndex = 0
  button.style.display = "inline-flex"
  button.style.alignItems = "center"
  button.style.justifyContent = "center"
  button.style.width = "63px"
  button.style.height = "63px"
  button.style.boxSizing = "border-box"
  button.style.padding = "0"
  button.style.backgroundImage = `url("${buttonImageUrl}")`
  button.style.backgroundPosition = "center"
  button.style.backgroundRepeat = "no-repeat"
  button.style.backgroundSize = "cover"
  button.style.backgroundColor = "transparent"
  button.style.border = "0"
  button.style.borderRadius = "50%"
  button.style.cursor = "pointer"
  button.style.whiteSpace = "nowrap"

  const actionButtons: HTMLButtonElement[] = []
  for (const action of config.actions ?? []) {
    const actionButton = document.createElement("button")
    actionButton.type = "button"
    actionButton.className = "aip2e-action-button"
    actionButton.setAttribute("data-action-kind", action.kind)
    actionButton.setAttribute("aria-label", action.label)
    actionButton.title = action.label
    actionButton.textContent = action.kind === "personalize" ? "✦" : action.kind === "edit_and_resend" ? "✎" : "↻"
    actionButton.tabIndex = 0
    actionButtons.push(actionButton)
  }

  let prompt = config.prompt
  let ready = true
  let actionBusy = false

  const requestDownload = (): void => {
    if (!ready) {
      return
    }
    config.onRequest({
      prompt,
      provider: config.provider,
      associationType: config.associationType,
      acknowledgeC2PA: true,
    })
  }

  const consumeInteraction = (event: Event): void => {
    event.preventDefault()
    event.stopPropagation()
  }

  const activate = (): void => {
    spinButton(button)
    requestDownload()
  }

  const activateAction = (action: ProviderAction, actionButton: HTMLButtonElement): void => {
    if (!ready || actionBusy || config.onAction === undefined) return
    actionBusy = true
    actionButton.disabled = true
    spinButton(actionButton)
    void config.onAction(action).finally(() => {
      actionBusy = false
      if (ready) actionButton.disabled = false
    })
  }

  const handleClick = (event: MouseEvent): void => {
    consumeInteraction(event)
    activate()
  }

  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Enter" || event.key === " ") {
      consumeInteraction(event)
      activate()
    }
  }

  const showControl = (): void => {
    control.style.opacity = "1"
    control.style.pointerEvents = "auto"
  }

  const hideControl = (): void => {
    control.style.opacity = "0"
    control.style.pointerEvents = "none"
  }

  button.addEventListener("pointerdown", consumeInteraction)
  button.addEventListener("mousedown", consumeInteraction)
  button.addEventListener("click", handleClick)
  button.addEventListener("keydown", handleKeydown)
  button.addEventListener("focus", showControl)
  button.addEventListener("blur", hideControl)

  const actionListeners = (config.actions ?? []).map((action, index) => {
    const actionButton = actionButtons[index]
    if (actionButton === undefined) return undefined
    const handleActionClick = (event: MouseEvent): void => {
      consumeInteraction(event)
      activateAction(action, actionButton)
    }
    const handleActionKeydown = (event: KeyboardEvent): void => {
      if (event.key === "Enter" || event.key === " ") {
        consumeInteraction(event)
        activateAction(action, actionButton)
      }
    }
    actionButton.addEventListener("pointerdown", consumeInteraction)
    actionButton.addEventListener("mousedown", consumeInteraction)
    actionButton.addEventListener("click", handleActionClick)
    actionButton.addEventListener("keydown", handleActionKeydown)
    return { actionButton, handleActionClick, handleActionKeydown }
  })

  config.container.addEventListener("mouseenter", showControl)
  config.container.addEventListener("mouseleave", hideControl)

  const buttonGroup = document.createElement("div")
  buttonGroup.className = "aip2e-button-group"
  buttonGroup.appendChild(button)
  for (const actionButton of actionButtons) buttonGroup.appendChild(actionButton)
  control.appendChild(buttonGroup)
  config.container.appendChild(control)

  const handle: DownloadControlHandle = {
    dispose: () => {
      mountedControls.delete(config.imageElement)
      button.removeEventListener("pointerdown", consumeInteraction)
      button.removeEventListener("mousedown", consumeInteraction)
      button.removeEventListener("click", handleClick)
      button.removeEventListener("keydown", handleKeydown)
      button.removeEventListener("focus", showControl)
      button.removeEventListener("blur", hideControl)
      for (const listener of actionListeners) {
        if (listener === undefined) continue
        listener.actionButton.removeEventListener("pointerdown", consumeInteraction)
        listener.actionButton.removeEventListener("mousedown", consumeInteraction)
        listener.actionButton.removeEventListener("click", listener.handleActionClick)
        listener.actionButton.removeEventListener("keydown", listener.handleActionKeydown)
      }
      config.container.removeEventListener("mouseenter", showControl)
      config.container.removeEventListener("mouseleave", hideControl)
      control.remove()
    },
    setPrompt: (nextPrompt) => {
      prompt = nextPrompt
    },
    setReady: (nextReady) => {
      ready = nextReady
      button.disabled = !nextReady
      for (const actionButton of actionButtons) actionButton.disabled = !nextReady || actionBusy
    },
  }

  mountedControls.set(config.imageElement, handle)
  return handle
}
