import { normalizePromptText } from "../../shared/association"
import {
  type ImageCandidate,
  type ImageCandidateId,
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
import { CHATGPT_SELECTORS } from "./selectors"

export type ChatGptTurn = {
  readonly turnId: ProviderTurnId
  readonly role: "user" | "assistant"
  readonly element: Element
}

export type ChatGptImageDescriptor = {
  readonly candidate: ImageCandidate
  readonly turnId: ProviderTurnId
  readonly hasDownloadControl: boolean
}

export type ChatGptCaptureResult =
  | {
      readonly kind: "ok"
      readonly promptCapture: PromptCapture
      readonly images: readonly ChatGptImageDescriptor[]
      readonly association: "provider_identity" | "confirmation_required"
      readonly candidateCount: number
    }
  | {
      readonly kind: "rejected"
      readonly reason: "prompt_missing" | "no_assistant_turn" | "no_images"
    }

const UPLOAD_ALT_PATTERN = /^uploaded image/iu

function turnKey(turn: Element, index: number): ProviderTurnId {
  const testid = turn.getAttribute("data-testid") ?? ""
  const stable = testid !== "" ? testid : `turn-${index}`
  return providerTurnId(`chatgpt:${stable}`)
}

function roleOf(turn: Element): "user" | "assistant" | undefined {
  if (turn.querySelector(CHATGPT_SELECTORS.assistantTurn) !== null) return "assistant"
  if (turn.querySelector(CHATGPT_SELECTORS.userTurn) !== null) return "user"
  return undefined
}

function userTurnText(turn: Element): string {
  const node = turn.querySelector(CHATGPT_SELECTORS.userTurnText)
  return node?.textContent ?? ""
}

const GENERATED_ALT_PATTERN = /generated|created|image/iu

function isGeneratedImage(image: Element): boolean {
  const alt = image.getAttribute("alt") ?? ""
  if (UPLOAD_ALT_PATTERN.test(alt)) return false
  const src = image.getAttribute("src") ?? ""
  if (src.includes("oaiusercontent.com") || src.includes("azureedge.net")) return true
  // Lazy-loaded images have no src yet; the generated-image alt text plus a
  // download control keeps them candidates pending confirmation.
  return alt !== "" && GENERATED_ALT_PATTERN.test(alt)
}

function imageDescriptor(
  image: Element,
  turnId: ProviderTurnId,
  now: UnixMilliseconds,
  index: number,
): ChatGptImageDescriptor {
  const src = image.getAttribute("src") ?? ""
  const candidate: ImageCandidate = {
    id: imageCandidateId(`chatgpt:${turnId}:${index}`),
    provider: "chatgpt",
    sourceUrl: imageUrl(src),
    observedAt: now,
    providerTurnId: turnId,
  }
  const container = image.closest("figure") ?? image.parentElement ?? image
  const hasDownloadControl =
    container.querySelector(CHATGPT_SELECTORS.downloadControl) !== null ||
    image.parentElement?.querySelector(CHATGPT_SELECTORS.downloadControl) !== null
  // A candidate is only fully proven when both a provider-visible download
  // control and a resolvable source URL exist; lazy images stay pending.
  const proven = hasDownloadControl && src !== ""
  return { candidate, turnId, hasDownloadControl: proven }
}

/**
 * Captures the provisional composer text (before submission reconciliation).
 */
export function captureProvisionalPrompt(document_like: Document): PromptCapture | undefined {
  const composer = document_like.querySelector(CHATGPT_SELECTORS.composer)
  const text = composer?.textContent ?? ""
  if (normalizePromptText(text) === "") return undefined
  return {
    id: promptCaptureId(`chatgpt:provisional:${Date.now()}`),
    provider: "chatgpt",
    originalPrompt: normalizePromptText(text),
    capturedAt: unixMilliseconds(Date.now()),
  }
}

/**
 * Reconciles the captured prompt against the rendered user turns. Only an
 * exact normalized match binds a turn; otherwise no identity is proven.
 */
export function reconcileUserTurn(
  document_like: Document,
  prompt: string,
): { turn: ChatGptTurn; index: number } | undefined {
  const turns = [...document_like.querySelectorAll(CHATGPT_SELECTORS.turn)]
  const normalized = normalizePromptText(prompt)
  if (normalized === "") return undefined
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (turn === undefined || roleOf(turn) !== "user") continue
    if (normalizePromptText(userTurnText(turn)) === normalized) {
      return { turn: { turnId: turnKey(turn, index), role: "user", element: turn }, index }
    }
  }
  return undefined
}

/**
 * Classifies generated images inside the assistant turn that immediately
 * follows the reconciled user turn. Returns confirmation_required when the
 * assistant turn cannot be uniquely identified or a full-size PNG cannot be
 * proven — never auto-associates in that case.
 */
export function classifyAssistantImages(
  document_like: Document,
  userTurnIndex: number,
  now: UnixMilliseconds,
): {
  images: readonly ChatGptImageDescriptor[]
  assistantTurnId: ProviderTurnId | undefined
  association: "provider_identity" | "confirmation_required"
  candidateCount: number
} {
  const turns = [...document_like.querySelectorAll(CHATGPT_SELECTORS.turn)]
  const assistant = turns[userTurnIndex + 1]
  if (assistant === undefined || roleOf(assistant) !== "assistant") {
    return {
      images: [],
      assistantTurnId: undefined,
      association: "confirmation_required",
      candidateCount: 0,
    }
  }
  const turnId = turnKey(assistant, userTurnIndex + 1)
  const images = [...assistant.querySelectorAll("img")].filter(isGeneratedImage)
  const descriptors = images.map((image, index) => imageDescriptor(image, turnId, now, index))
  const allProven = descriptors.length > 0 && descriptors.every((d) => d.hasDownloadControl)
  return {
    images: descriptors,
    assistantTurnId: turnId,
    association: allProven ? "provider_identity" : "confirmation_required",
    candidateCount: descriptors.length,
  }
}

/**
 * Full capture flow: reconcile the prompt to a user turn, then classify the
 * following assistant turn's images. Pure DOM-in → typed-result-out.
 */
export function captureChatGptTurn(
  document_like: Document,
  prompt: string,
  now: UnixMilliseconds,
  captureId: PromptCaptureId,
): ChatGptCaptureResult {
  const normalized = normalizePromptText(prompt)
  if (normalized === "") {
    return { kind: "rejected", reason: "prompt_missing" }
  }
  const reconciled = reconcileUserTurn(document_like, normalized)
  if (reconciled === undefined) {
    return { kind: "rejected", reason: "prompt_missing" }
  }
  const classified = classifyAssistantImages(document_like, reconciled.index, now)
  if (classified.images.length === 0) {
    return { kind: "rejected", reason: "no_images" }
  }
  const promptCapture: PromptCapture = {
    id: captureId,
    provider: "chatgpt",
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

export type { ImageCandidateId }
