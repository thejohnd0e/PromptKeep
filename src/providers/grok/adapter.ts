import { normalizePromptText } from "../../shared/association"
import {
  imageCandidateId,
  imageUrl,
  type ImageCandidate,
  type PromptCapture,
  type PromptCaptureId,
  providerTurnId,
  promptCaptureId,
  type ProviderTurnId,
  type UnixMilliseconds,
  unixMilliseconds,
} from "../../shared/contracts"
import type { ProviderImage, ScanResult } from "../types"
import { GROK_SELECTORS } from "./selectors"

export type GrokImageDescriptor = ProviderImage & {
  readonly turnId: ProviderTurnId
}

type GrokScanResult = Omit<ScanResult, "images"> & {
  readonly images: readonly GrokImageDescriptor[]
}

export type GrokCaptureResult =
  | {
      readonly kind: "ok"
      readonly promptCapture: PromptCapture
      readonly images: readonly GrokImageDescriptor[]
      readonly association: "provider_identity"
      readonly candidateCount: number
    }
  | {
      readonly kind: "rejected"
      readonly reason: "prompt_missing" | "no_images" | "changed_dom"
    }

const GROK_ASSET_PATTERN =
  /^https:\/\/assets\.grok\.com\/users\/[^/]+\/generated\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/image\.(?:jpg|jpeg|png|webp)(?:\?[^#]*)?$/iu

function sourceFromImage(image: Element): { url: string; assetId: string } | undefined {
  const source = image.getAttribute("src") ?? ""
  const match = GROK_ASSET_PATTERN.exec(source)
  if (match?.[1] === undefined) return undefined
  return { url: source, assetId: match[1].toLowerCase() }
}

function turnIdForAsset(assetId: string): ProviderTurnId {
  return providerTurnId(`grok:imagine:${assetId}`)
}

function descriptor(image: Element, now: UnixMilliseconds, index: number): GrokImageDescriptor | undefined {
  const source = sourceFromImage(image)
  if (source === undefined) return undefined
  const turnId = turnIdForAsset(source.assetId)
  const candidate: ImageCandidate = {
    id: imageCandidateId(`grok:imagine:${source.assetId}:${index}`),
    provider: "grok",
    sourceUrl: imageUrl(source.url),
    observedAt: now,
    providerTurnId: turnId,
  }
  return { candidate, proven: true, element: image, turnId }
}

function articleImages(document_like: Document): readonly Element[] {
  const article = document_like.querySelector(GROK_SELECTORS.postArticle)
  if (article === null) return []
  return [...article.querySelectorAll(GROK_SELECTORS.image)]
}

function promptForImage(image: Element): string {
  return normalizePromptText(image.getAttribute("alt") ?? "")
}

export function scanGrokImagine(document_like: Document, now: UnixMilliseconds): readonly GrokScanResult[] {
  const images = articleImages(document_like)
  const descriptors = images
    .map((image, index) => descriptor(image, now, index))
    .filter((value): value is GrokImageDescriptor => value !== undefined)
  if (descriptors.length === 0) return []

  const groups = new Map<string, { prompt: string; images: GrokImageDescriptor[] }>()
  for (const image of descriptors) {
    const prompt = promptForImage(image.element)
    if (prompt === "") continue
    const group = groups.get(image.turnId)
    if (group === undefined) {
      groups.set(image.turnId, { prompt, images: [image] })
    } else if (group.prompt === prompt) {
      group.images.push(image)
    }
  }

  return [...groups].map(([turnId, group]) => ({
    prompt: group.prompt,
    turnId,
    association: "provider_identity" as const,
    images: group.images,
  }))
}

export function captureGrokTurn(
  document_like: Document,
  prompt: string,
  now: UnixMilliseconds,
  captureId: PromptCaptureId,
): GrokCaptureResult {
  const normalized = normalizePromptText(prompt)
  if (normalized === "") return { kind: "rejected", reason: "prompt_missing" }
  const result = scanGrokImagine(document_like, now).find((entry) => entry.prompt === normalized)
  if (result === undefined || result.images.length === 0) {
    return { kind: "rejected", reason: result === undefined ? "changed_dom" : "no_images" }
  }
  return {
    kind: "ok",
    promptCapture: {
      id: captureId,
      provider: "grok",
      originalPrompt: normalized,
      capturedAt: now,
      providerTurnId: providerTurnId(result.turnId),
    },
    images: result.images,
    association: "provider_identity",
    candidateCount: result.images.length,
  }
}

export function captureProvisionalPrompt(document_like: Document): PromptCapture | undefined {
  const composer = document_like.querySelector(GROK_SELECTORS.composer)
  const text = normalizePromptText(composer?.textContent ?? "")
  if (text === "") return undefined
  return {
    id: promptCaptureId(`grok:imagine:provisional:${Date.now()}`),
    provider: "grok",
    originalPrompt: text,
    capturedAt: unixMilliseconds(Date.now()),
  }
}
