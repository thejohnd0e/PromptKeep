import { type ChatGptScanResult, scanChatGptTurns } from "../providers/chatgpt/adapter"
import { type GeminiScanResult, scanGeminiTurns } from "../providers/gemini/adapter"
import { type GrokScanResult, scanGrokTurns } from "../providers/grok/adapter"
import type { PromptCapture, Provider, UnixMilliseconds } from "../shared/contracts"
import { promptCaptureId } from "../shared/contracts"
import type { ContentResponse, InitiateOperationMessage } from "../shared/messages"
import { MESSAGE_VERSION, operationNonce } from "../shared/messages"
import { type DownloadControlHandle, mountDownloadControl } from "./image-action"
import { mountStatusUI, type StatusHandle } from "./status-ui"

export type ScanResult = {
  readonly prompt: string
  readonly turnId: string
  readonly association: "provider_identity" | "confirmation_required"
  readonly images: readonly {
    readonly candidate: InitiateOperationMessage["imageCandidate"]
    readonly proven: boolean
    readonly element: Element
  }[]
}

export type ControllerDeps = {
  readonly document_like: Document
  readonly provider: Provider
  readonly scan: (doc: Document, now: UnixMilliseconds) => readonly ScanResult[]
  readonly sendInitiate: (message: InitiateOperationMessage) => Promise<ContentResponse>
  readonly now: () => UnixMilliseconds
  readonly pageUrl: () => string
}

export type ControllerHandle = {
  readonly dispose: () => void
}

type ScanAdapter = (doc: Document, now: UnixMilliseconds) => readonly ScanResult[]

function asScan(
  scan: readonly (ChatGptScanResult | GeminiScanResult | GrokScanResult)[],
): ScanResult[] {
  return scan.map((entry) => ({
    prompt: entry.prompt,
    turnId: entry.turnId,
    association: entry.association,
    images: entry.images.map((image) => ({
      candidate: image.candidate,
      proven: image.proven,
      element: image.element,
    })),
  }))
}

export function adapterFor(provider: Provider): ScanAdapter {
  switch (provider) {
    case "chatgpt":
      return (doc, now) => asScan(scanChatGptTurns(doc, now))
    case "gemini":
      return (doc, now) => asScan(scanGeminiTurns(doc, now))
    case "grok":
      return (doc, now) => asScan(scanGrokTurns(doc, now))
  }
}

function associationType(association: "provider_identity" | "confirmation_required") {
  return association === "provider_identity"
    ? ("deterministic" as const)
    : ("user_confirmed" as const)
}

/**
 * Content-script controller: scans the provider DOM with the matching
 * adapter, mounts a "Download with prompt" control beside every generated
 * image, and sends one initiate_operation per confirmed download. A
 * MutationObserver re-scans on SPA navigation and lazy loads; controls whose
 * image left the DOM are disposed.
 */
export function startController(deps: ControllerDeps): ControllerHandle {
  const controls = new Set<DownloadControlHandle>()
  const mountedElements = new WeakSet<Element>()
  const elementByHandle = new Map<DownloadControlHandle, Element>()
  let status: StatusHandle | undefined
  let rescanTimer: number | undefined

  const showStatus = (level: "success" | "error", code: string, message: string): void => {
    status?.dispose()
    status = mountStatusUI({
      container: deps.document_like.body,
      code,
      message,
      level,
    })
  }

  const handleRequest = async (
    prompt: string,
    turnId: string,
    candidate: InitiateOperationMessage["imageCandidate"],
  ): Promise<void> => {
    const nonce = operationNonce(crypto.randomUUID().replaceAll("-", ""))
    const sourceUrl = deps.pageUrl()
    const capture: PromptCapture = {
      id: promptCaptureId(crypto.randomUUID().replaceAll("-", "")),
      provider: deps.provider,
      originalPrompt: prompt,
      capturedAt: deps.now(),
      ...(turnId === ""
        ? {}
        : { providerTurnId: turnId as NonNullable<PromptCapture["providerTurnId"]> }),
      ...(sourceUrl === "" ? {} : { sourceUrl }),
    }
    const message: InitiateOperationMessage = {
      version: MESSAGE_VERSION,
      type: "initiate_operation",
      nonce,
      createdAt: deps.now(),
      promptCapture: capture,
      imageCandidate: candidate,
    }
    const response = await deps.sendInitiate(message)
    if (response.type === "operation_accepted") {
      // Success is signalled by the button spin animation instead of a banner.
    } else if (response.type === "operation_rejected") {
      showStatus("error", response.error.code, "The download could not be completed.")
    } else {
      showStatus("error", response.reason.code, "The request was rejected.")
    }
  }

  const mountAll = (): void => {
    for (const entry of deps.scan(deps.document_like, deps.now())) {
      for (const image of entry.images) {
        if (mountedElements.has(image.element)) continue
        mountedElements.add(image.element)
        const handle = mountDownloadControl({
          container: image.element.parentElement ?? deps.document_like.body,
          imageElement: image.element as HTMLElement,
          label: "Download with prompt",
          provider: deps.provider,
          prompt: entry.prompt,
          associationType: associationType(entry.association),
          onRequest: () => {
            void handleRequest(entry.prompt, entry.turnId, image.candidate)
          },
        })
        controls.add(handle)
        elementByHandle.set(handle, image.element)
      }
    }
  }

  const disposeStale = (): void => {
    for (const [handle, element] of [...elementByHandle.entries()]) {
      if (!element.isConnected) {
        handle.dispose()
        elementByHandle.delete(handle)
        mountedElements.delete(element)
      }
    }
  }

  const observer = new MutationObserver(() => {
    if (rescanTimer !== undefined) return
    rescanTimer = deps.document_like.defaultView?.setTimeout(() => {
      rescanTimer = undefined
      disposeStale()
      mountAll()
    }, 200) as unknown as number
  })

  mountAll()
  observer.observe(deps.document_like.body ?? deps.document_like.documentElement, {
    childList: true,
    subtree: true,
  })

  return {
    dispose: () => {
      observer.disconnect()
      if (rescanTimer !== undefined) {
        deps.document_like.defaultView?.clearTimeout(rescanTimer)
      }
      for (const handle of controls) handle.dispose()
      controls.clear()
      status?.dispose()
    },
  }
}
