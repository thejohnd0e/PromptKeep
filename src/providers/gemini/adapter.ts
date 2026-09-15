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
  readonly element: Element
  readonly fullSizeElement?: Element
}

export type GeminiScanResult = {
  readonly prompt: string
  readonly turnId: ProviderTurnId
  readonly images: readonly GeminiImageDescriptor[]
  readonly association: "provider_identity" | "confirmation_required"
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
  const node =
    turn.querySelector(GEMINI_SELECTORS.userTurnText) ??
    turn.querySelector(GEMINI_SELECTORS.userTurnTextFallback)
  return node?.textContent ?? ""
}

function isGeneratedImage(image: Element): boolean {
  const cls = image.getAttribute("class") ?? ""
  if (cls.includes("generated-image")) return true
  const src = image.getAttribute("src") ?? ""
  const alt = image.getAttribute("alt") ?? ""
  if (src.startsWith("blob:") && alt.includes("AI generated")) return true
  return src.includes("lh3.googleusercontent.com")
}

function nearbyDownloadControl(image: Element): Element | null {
  const parent = image.parentElement
  const containers = [
    image.closest("figure"),
    parent,
    parent?.parentElement,
    image.closest("model-response"),
    image,
  ]
  for (const container of containers) {
    const control = container?.querySelector(GEMINI_SELECTORS.downloadControl)
    if (control !== undefined && control !== null) return control
  }
  return null
}

function imageDescriptor(
  image: Element,
  turnId: ProviderTurnId,
  now: UnixMilliseconds,
  index: number,
): GeminiImageDescriptor {
  const src = image.getAttribute("src") ?? ""
  const downloadControl = nearbyDownloadControl(image)
  const fullSizeHref = downloadControl?.getAttribute("href") ?? null
  const sourceUrl = fullSizeHref ?? src
  const candidate: ImageCandidate = {
    id: imageCandidateId(`gemini:${turnId}:${index}`),
    provider: "gemini",
    sourceUrl: imageUrl(sourceUrl),
    observedAt: now,
    providerTurnId: turnId,
  }
  const proven = downloadControl !== null && src !== ""
  const descriptor = {
    candidate,
    turnId,
    proven,
    element: image,
  }
  if (downloadControl === null || fullSizeHref !== null) return descriptor
  return { ...descriptor, fullSizeElement: downloadControl }
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

/**
 * Content-script scan: pairs every rendered user turn with the model turn
 * that follows it and classifies the generated images found there. The
 * prompt comes from the rendered user turn itself (deterministic turn
 * containment); duplicate prompts stay bound to the latest match.
 */
export function scanGeminiTurns(
  document_like: Document,
  now: UnixMilliseconds,
): readonly GeminiScanResult[] {
  const turns = [...document_like.querySelectorAll(GEMINI_SELECTORS.turn)]
  const results: GeminiScanResult[] = []
  for (let index = 0; index < turns.length - 1; index += 1) {
    const turn = turns[index]
    if (turn === undefined || !isUserTurn(turn)) continue
    const prompt = normalizePromptText(userTurnText(turn))
    if (prompt === "") continue
    const classified = classifyModelImages(document_like, index, now)
    if (classified.images.length === 0 || classified.modelTurnId === undefined) continue
    results.push({
      prompt,
      turnId: classified.modelTurnId,
      images: classified.images,
      association: classified.association,
    })
  }
  return results
}
