export type StatusLevel = "info" | "success" | "warning" | "error"

export type StatusConfig = {
  readonly container: HTMLElement
  readonly code: string
  readonly message: string
  readonly level: StatusLevel
}

export type StatusHandle = {
  readonly dispose: () => void
  readonly update: (config: Partial<StatusConfig>) => void
}

function roleForLevel(level: StatusLevel): string {
  return level === "error" ? "alert" : "status"
}

export function mountStatusUI(config: StatusConfig): StatusHandle {
  const element = document.createElement("div")
  element.className = `aip2e-status aip2e-status-${config.level}`
  element.setAttribute("role", roleForLevel(config.level))

  const codeElement = document.createElement("span")
  codeElement.className = "aip2e-status-code"
  codeElement.textContent = config.code

  const messageElement = document.createElement("span")
  messageElement.className = "aip2e-status-message"
  messageElement.textContent = config.message

  element.appendChild(codeElement)
  element.appendChild(messageElement)
  config.container.appendChild(element)

  return {
    dispose: () => {
      element.remove()
    },
    update: (next) => {
      if (next.code !== undefined) {
        codeElement.textContent = next.code
      }
      if (next.message !== undefined) {
        messageElement.textContent = next.message
      }
      if (next.level !== undefined) {
        element.className = `aip2e-status aip2e-status-${next.level}`
        element.setAttribute("role", roleForLevel(next.level))
      }
    },
  }
}
