import type { ProviderAction, ProviderAdapter, ProviderImage } from "../providers/types"
import type { PromptCapture, Provider, UnixMilliseconds } from "../shared/contracts"
import { promptCaptureId } from "../shared/contracts"
import type { ContentResponse, InitiateOperationMessage } from "../shared/messages"
import { MESSAGE_VERSION, operationNonce } from "../shared/messages"
import { type DownloadControlHandle, mountDownloadControl } from "./image-action"
import { mountStatusUI, type StatusHandle } from "./status-ui"

export type ControllerDeps = ProviderAdapter & {
  readonly document_like: Document
  readonly provider: Provider
  readonly sendInitiate: (message: InitiateOperationMessage) => Promise<ContentResponse>
  readonly now: () => UnixMilliseconds
  readonly pageUrl: () => string
  readonly extensionVersion: string
}

type StatusLevel = "success" | "error"

export type ControllerHandle = {
  readonly dispose: () => void
}

function associationType(association: "provider_identity" | "confirmation_required") {
  return association === "provider_identity"
    ? ("deterministic" as const)
    : ("user_confirmed" as const)
}

function errorMessage(error: ContentResponse): string {
  if (error.type === "operation_rejected") {
    switch (error.error.code) {
      case "download_failed":
        if (error.error.status !== undefined) {
          return `The image server rejected the download with HTTP ${String(error.error.status)}.`
        }
        return error.error.reason === undefined
          ? "The download failed before the extension received a detailed error."
          : `Download failed before image bytes were available: ${error.error.reason}.`
      case "unsupported_media_type":
        return `Unsupported image response: ${error.error.mediaType}.`
      case "operation_cancelled":
        return "The download was cancelled before it completed."
      case "input_too_large":
        return "The image is too large to process."
      default:
        return "The download could not be completed."
    }
  }
  return "The request was rejected."
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
  const mountedElements = new Map<
    Element,
    { readonly handle: DownloadControlHandle; image: ProviderImage; prompt: string; turnId: string; model: string | undefined }
  >()
  let status: StatusHandle | undefined
  let rescanTimer: number | undefined
  let initialScan = true

  const showStatus = (level: StatusLevel, code: string, message: string): void => {
    status?.dispose()
    status = mountStatusUI({
      container: deps.document_like.body,
      code,
      message,
      level,
    })
  }

  const clearStatus = (): void => {
    status?.dispose()
    status = undefined
  }

  const handleRequest = async (
    prompt: string,
    turnId: string,
    image: ProviderImage,
    model?: string,
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
      ...(model === undefined ? {} : { model }),
    }
    showStatus("success", "DOWNLOAD_STARTED", "Preparing the image download.")
    let imageBytes: readonly number[] | undefined
    try {
      imageBytes = await deps.readImageBytes?.(image)
    } catch (error) {
      showStatus(
        "error",
        "download_failed",
        error instanceof Error ? error.message : "Could not prepare the image download.",
      )
      return
    }
    const message: InitiateOperationMessage = {
      version: MESSAGE_VERSION,
      type: "initiate_operation",
      nonce,
      createdAt: deps.now(),
      promptCapture: capture,
      imageCandidate: image.candidate,
      ...(imageBytes === undefined ? {} : { imageBytes }),
    }
    let response: ContentResponse
    try {
      response = await deps.sendInitiate(message)
    } catch {
      showStatus(
        "error",
        "EXTENSION_CONTEXT_STALE",
        `Refresh this tab after reloading extension v${deps.extensionVersion}, then try again.`,
      )
      return
    }
    if (response.type === "operation_accepted") {
      clearStatus()
    } else if (response.type === "operation_rejected") {
      showStatus("error", response.error.code, errorMessage(response))
    } else {
      showStatus("error", response.reason.code, errorMessage(response))
    }
  }

  const handleAction = async (action: ProviderAction): Promise<void> => {
    showStatus("success", "ACTION_STARTED", `${action.label} is starting.`)
    try {
      await action.run()
      clearStatus()
    } catch (error) {
      showStatus(
        "error",
        "action_failed",
        error instanceof Error ? error.message : `${action.label} could not be completed.`,
      )
    }
  }

  const mountAll = (): void => {
    for (const entry of deps.scan(deps.document_like, deps.now())) {
      for (const image of entry.images) {
        const model = initialScan ? undefined : entry.model
        const existing = mountedElements.get(image.element)
        if (existing !== undefined) {
          existing.image = image
          existing.prompt = entry.prompt
          existing.turnId = entry.turnId
          existing.model = model
          existing.handle.setPrompt(entry.prompt)
          continue
        }
        const state: {
          image: ProviderImage
          prompt: string
          turnId: string
          model: string | undefined
          handle: DownloadControlHandle
        } = {
          image,
          prompt: entry.prompt,
          turnId: entry.turnId,
          model,
          handle: undefined as unknown as DownloadControlHandle,
        }
        const handle = mountDownloadControl({
          container: image.element.parentElement ?? deps.document_like.body,
          imageElement: image.element as HTMLElement,
          label: "Download with prompt",
          provider: deps.provider,
          prompt: state.prompt,
          associationType: associationType(entry.association),
          ...(entry.actions === undefined ? {} : { actions: entry.actions, onAction: handleAction }),
          onRequest: () => {
            void handleRequest(state.prompt, state.turnId, state.image, state.model)
          },
        })
        state.handle = handle
        controls.add(handle)
        mountedElements.set(image.element, state)
      }
    }
  }

  const disposeStale = (): void => {
    for (const [element, state] of [...mountedElements.entries()]) {
      if (!element.isConnected) {
        state.handle.dispose()
        mountedElements.delete(element)
        controls.delete(state.handle)
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
  initialScan = false
  observer.observe(deps.document_like.body ?? deps.document_like.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "alt"],
  })

  return {
    dispose: () => {
      observer.disconnect()
      if (rescanTimer !== undefined) {
        deps.document_like.defaultView?.clearTimeout(rescanTimer)
      }
      for (const handle of controls) handle.dispose()
      controls.clear()
      mountedElements.clear()
      status?.dispose()
    },
  }
}
