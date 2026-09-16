import type { Provider } from "../shared/contracts"
import type { AssociationType } from "./confirmation-dialog"

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
  if (config.provider === "gemini") {
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
  button.textContent = "A"
  button.setAttribute("aria-label", config.label)
  button.title = config.label
  button.tabIndex = 0
  button.style.display = "inline-flex"
  button.style.alignItems = "center"
  button.style.justifyContent = "center"
  button.style.width = "42px"
  button.style.height = "42px"
  button.style.boxSizing = "border-box"
  button.style.padding = "0"
  button.style.fontSize = "16px"
  button.style.fontWeight = "700"
  button.style.lineHeight = "1"
  button.style.fontFamily = "inherit"
  button.style.color = "#000000"
  button.style.backgroundColor = "#ffffff"
  button.style.border = "2px solid #000000"
  button.style.borderRadius = "50%"
  button.style.cursor = "pointer"
  button.style.whiteSpace = "nowrap"

  let prompt = config.prompt
  let ready = true

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

  config.container.addEventListener("mouseenter", showControl)
  config.container.addEventListener("mouseleave", hideControl)

  control.appendChild(button)
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
    },
  }

  mountedControls.set(config.imageElement, handle)
  return handle
}
