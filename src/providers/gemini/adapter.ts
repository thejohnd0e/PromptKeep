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
import { GEMINI_SELECTORS } from "./selectors"

export type GeminiImageDescriptor = {
  readonly candidate: ImageCandidate
  readonly turnId: ProviderTurnId
  readonly proven: boolean
}

export type GeminiCaptureResult =
  | {
      readonly kind: "ok"
      readonly promptCapture: PromptCapture
      readonly images: readonly GeminiImageDescriptor[]
      readonly association: "provider_identity" | "confirmation_required"
      readonly candidateCount: number
    }
  | {
      readonly kind: "rejected"
      readonly reason:
        | "prompt_missing"
        | "no_model_turn"
        | "no_images"
        | "unsupported_library_state"
    }

function turnKey(turn: Element, index: number): ProviderTurnId {
  const stable = turn.getAttribute("data-turn-id") ?? `turn-${index}`
  return providerTurnId(`gemini:${stable}`)
}

function isModelTurn(turn: Element): boolean {
  return (
    turn.tagName.toLowerCase() === "model-response" ||
    turn.querySelector(GEMINI_SELECTORS.modelTurn) !== null
  )
}

function isUserTurn(turn: Element): boolean {
  return (
    turn.tagName.toLowerCase() === "user-query" ||
    turn.querySelector(GEMINI_SELECTORS.userTurn) !== null
  )
}

function userTurnText(turn: Element): string {
  const node = turn.querySelector(GEMINI_SELECTORS.userTurnText)
  return node?.textContent ?? ""
}

function isGeneratedImage(image: Element): boolean {
  const cls = image.getAttribute("class") ?? ""
  if (cls.includes("generated-image")) return true
  const src = image.getAttribute("src") ?? ""
  return src.includes("lh3.googleusercontent.com")
}

function imageDescriptor(
  image: Element,
  turnId: ProviderTurnId,
  now: UnixMilliseconds,
  index: number,
): GeminiImageDescriptor {
  const src = image.getAttribute("src") ?? ""
  const candidate: ImageCandidate = {
    id: imageCandidateId(`gemini:${turnId}:${index}`),
    provider: "gemini",
    sourceUrl: imageUrl(src),
    observedAt: now,
    providerTurnId: turnId,
  }
  const container = image.closest("figure") ?? image.parentElement ?? image
  const hasDownloadControl =
    container.querySelector(GEMINI_SELECTORS.downloadControl) !== null ||
    image.parentElement?.querySelector(GEMINI_SELECTORS.downloadControl) !== null
  const proven = hasDownloadControl && src !== ""
  return { candidate, turnId, proven }
}

export function captureProvisionalPrompt(document_like: Document): PromptCapture | undefined {
  const composer = document_like.querySelector(GEMINI_SELECTORS.composer)
  const text = composer?.textContent ?? ""
  if (normalizePromptText(text) === "") return undefined
  return {
    id: promptCaptureId(`gemini:provisional:${Date.now()}`),
    provider: "gemini",
    originalPrompt: normalizePromptText(text),
    capturedAt: unixMilliseconds(Date.now()),
  }
}

export function reconcileUserTurn(
  document_like: Document,
  prompt: string,
): { turn: Element; index: number } | undefined {
  const turns = [...document_like.querySelectorAll(GEMINI_SELECTORS.turn)]
  const normalized = normalizePromptText(prompt)
  if (normalized === "") return undefined
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (turn === undefined || !isUserTurn(turn)) continue
    if (normalizePromptText(userTurnText(turn)) === normalized) {
      return { turn, index }
    }
  }
  return undefined
}

export function classifyModelImages(
  document_like: Document,
  userTurnIndex: number,
  now: UnixMilliseconds,
): {
  images: readonly GeminiImageDescriptor[]
  modelTurnId: ProviderTurnId | undefined
  association: "provider_identity" | "confirmation_required"
  candidateCount: number
  unsupportedState: boolean
} {
  const turns = [...document_like.querySelectorAll(GEMINI_SELECTORS.turn)]
  const model = turns[userTurnIndex + 1]
  if (model === undefined || !isModelTurn(model)) {
    return {
      images: [],
      modelTurnId: undefined,
      association: "confirmation_required",
      candidateCount: 0,
      unsupportedState: false,
    }
  }
  const turnId = turnKey(model, userTurnIndex + 1)
  const unsupported = model.querySelector(GEMINI_SELECTORS.unsupportedState) !== null
  const images = [...model.querySelectorAll("img")].filter(isGeneratedImage)
  const descriptors = images.map((image, index) => imageDescriptor(image, turnId, now, index))
  const allProven = descriptors.length > 0 && descriptors.every((d) => d.proven)
  return {
    images: descriptors,
    modelTurnId: turnId,
    association: allProven ? "provider_identity" : "confirmation_required",
    candidateCount: descriptors.length,
    unsupportedState: unsupported,
  }
}

export function captureGeminiTurn(
  document_like: Document,
  prompt: string,
  now: UnixMilliseconds,
  captureId: PromptCaptureId,
): GeminiCaptureResult {
  const normalized = normalizePromptText(prompt)
  if (normalized === "") {
    return { kind: "rejected", reason: "prompt_missing" }
  }
  const reconciled = reconcileUserTurn(document_like, normalized)
  if (reconciled === undefined) {
    return { kind: "rejected", reason: "prompt_missing" }
  }
  const classified = classifyModelImages(document_like, reconciled.index, now)
  if (classified.unsupportedState) {
    return { kind: "rejected", reason: "unsupported_library_state" }
  }
  if (classified.images.length === 0) {
    return { kind: "rejected", reason: "no_images" }
  }
  const promptCapture: PromptCapture = {
    id: captureId,
    provider: "gemini",
    originalPrompt: normalized,
    capturedAt: now,
    ...(classified.modelTurnId === undefined ? {} : { providerTurnId: classified.modelTurnId }),
  }
  return {
    kind: "ok",
    promptCapture,
    images: classified.images,
    association: classified.association,
    candidateCount: classified.candidateCount,
  }
}
