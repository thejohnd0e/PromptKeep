import { normalizePromptText } from "../../shared/association"
import {
  type ImageCandidate,
  imageCandidateId,
  imageUrl,
  type PromptCapture,
  type PromptCaptureId,
  type ProviderTurnId,
  promptCaptureId,
  providerTurnId,
  type UnixMilliseconds,
  unixMilliseconds,
} from "../../shared/contracts"
import { GROK_SELECTORS } from "./selectors"

export type GrokImageDescriptor = {
  readonly candidate: ImageCandidate
  readonly turnId: ProviderTurnId
  readonly proven: boolean
  readonly expired: boolean
}

export type GrokCaptureResult =
  | {
      readonly kind: "ok"
      readonly promptCapture: PromptCapture
      readonly images: readonly GrokImageDescriptor[]
      readonly association: "provider_identity" | "confirmation_required"
      readonly candidateCount: number
    }
  | {
      readonly kind: "rejected"
      readonly reason:
        | "prompt_missing"
        | "no_assistant_message"
        | "no_images"
        | "stale_asset"
        | "asset_expired"
        | "asset_auth_failed"
    }

const EXPIRED_PATTERN = /expired|no longer available/iu
const AUTH_FAILED_PATTERN = /sign in|unauthorized|authentication/iu

function turnKey(message: Element, index: number): ProviderTurnId {
  const stable = message.getAttribute("data-message-id") ?? `msg-${index}`
  return providerTurnId(`grok:${stable}`)
}

function isAssistantMessage(message: Element): boolean {
  return (
    message.querySelector(GROK_SELECTORS.assistantMessage) !== null ||
    message.getAttribute("data-testid") === "assistant-message"
  )
}

function isUserMessage(message: Element): boolean {
  return (
    message.querySelector(GROK_SELECTORS.userMessage) !== null ||
    message.getAttribute("data-testid") === "user-message"
  )
}

function userMessageText(message: Element): string {
  const node = message.querySelector(GROK_SELECTORS.userMessageText)
  return node?.textContent ?? ""
}

function cardState(image: Element): "ok" | "expired" | "auth_failed" {
  const container = image.closest("[data-card-state]") ?? image.parentElement
  const state = container?.getAttribute("data-card-state") ?? ""
  if (EXPIRED_PATTERN.test(state)) return "expired"
  if (AUTH_FAILED_PATTERN.test(state)) return "auth_failed"
  return "ok"
}

function isGeneratedImage(image: Element): boolean {
  const testid = image.getAttribute("data-testid") ?? ""
  if (testid === "generated-image") return true
  const src = image.getAttribute("src") ?? ""
  return src.includes("grok-assets")
}

function imageDescriptor(
  image: Element,
  turnId: ProviderTurnId,
  now: UnixMilliseconds,
  index: number,
): GrokImageDescriptor {
  const src = image.getAttribute("src") ?? ""
  const candidate: ImageCandidate = {
    id: imageCandidateId(`grok:${turnId}:${index}`),
    provider: "grok",
    sourceUrl: imageUrl(src),
    observedAt: now,
    providerTurnId: turnId,
  }
  const container = image.closest("figure") ?? image.parentElement ?? image
  const hasDownloadControl =
    container.querySelector(GROK_SELECTORS.downloadControl) !== null ||
    image.parentElement?.querySelector(GROK_SELECTORS.downloadControl) !== null
  // Blob URLs are ephemeral session handles, not stable provider assets; they
  // keep the candidate alive but never prove full-size retrievability.
  const stableSrc = src !== "" && !src.startsWith("blob:")
  const proven = hasDownloadControl && stableSrc
  return { candidate, turnId, proven, expired: cardState(image) === "expired" }
}

export function captureProvisionalPrompt(document_like: Document): PromptCapture | undefined {
  const composer = document_like.querySelector(GROK_SELECTORS.composer)
  const text = composer?.textContent ?? ""
  if (normalizePromptText(text) === "") return undefined
  return {
    id: promptCaptureId(`grok:provisional:${Date.now()}`),
    provider: "grok",
    originalPrompt: normalizePromptText(text),
    capturedAt: unixMilliseconds(Date.now()),
  }
}

export function reconcileUserMessage(
  document_like: Document,
  prompt: string,
): { message: Element; index: number } | undefined {
  const messages = [...document_like.querySelectorAll(GROK_SELECTORS.message)]
  const normalized = normalizePromptText(prompt)
  if (normalized === "") return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === undefined || !isUserMessage(message)) continue
    if (normalizePromptText(userMessageText(message)) === normalized) {
      return { message, index }
    }
  }
  return undefined
}

export function classifyAssistantImages(
  document_like: Document,
  userMessageIndex: number,
  now: UnixMilliseconds,
): {
  images: readonly GrokImageDescriptor[]
  assistantTurnId: ProviderTurnId | undefined
  association: "provider_identity" | "confirmation_required"
  candidateCount: number
  hasExpired: boolean
  hasAuthFailed: boolean
} {
  const messages = [...document_like.querySelectorAll(GROK_SELECTORS.message)]
  const assistant = messages[userMessageIndex + 1]
  if (assistant === undefined || !isAssistantMessage(assistant)) {
    return {
      images: [],
      assistantTurnId: undefined,
      association: "confirmation_required",
      candidateCount: 0,
      hasExpired: false,
      hasAuthFailed: false,
    }
  }
  const turnId = turnKey(assistant, userMessageIndex + 1)
  const images = [...assistant.querySelectorAll("img")].filter(isGeneratedImage)
  const descriptors = images.map((image, index) => imageDescriptor(image, turnId, now, index))
  const allProven = descriptors.length > 0 && descriptors.every((d) => d.proven)
  return {
    images: descriptors,
    assistantTurnId: turnId,
    association: allProven ? "provider_identity" : "confirmation_required",
    candidateCount: descriptors.length,
    hasExpired: descriptors.some((d) => d.expired),
    hasAuthFailed: images.some((image) => cardState(image) === "auth_failed"),
  }
}

export function captureGrokTurn(
  document_like: Document,
  prompt: string,
  now: UnixMilliseconds,
  captureId: PromptCaptureId,
): GrokCaptureResult {
  const normalized = normalizePromptText(prompt)
  if (normalized === "") {
    return { kind: "rejected", reason: "prompt_missing" }
  }
  const reconciled = reconcileUserMessage(document_like, normalized)
  if (reconciled === undefined) {
    return { kind: "rejected", reason: "prompt_missing" }
  }
  const classified = classifyAssistantImages(document_like, reconciled.index, now)
  if (classified.hasAuthFailed) {
    return { kind: "rejected", reason: "asset_auth_failed" }
  }
  if (classified.hasExpired) {
    return { kind: "rejected", reason: "asset_expired" }
  }
  if (classified.images.length === 0) {
    return { kind: "rejected", reason: "no_images" }
  }
  const promptCapture: PromptCapture = {
    id: captureId,
    provider: "grok",
    originalPrompt: normalized,
    capturedAt: now,
    ...(classified.assistantTurnId === undefined
      ? {}
      : { providerTurnId: classified.assistantTurnId }),
  }
  return {
    kind: "ok",
    promptCapture,
    images: classified.images,
    association: classified.association,
    candidateCount: classified.candidateCount,
  }
}
