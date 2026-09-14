declare const brand: unique symbol

export type Brand<Value, Name extends string> = Value & { readonly [brand]: Name }

export type PromptCaptureId = Brand<string, "PromptCaptureId">
export type ImageCandidateId = Brand<string, "ImageCandidateId">
export type EnrichmentJobId = Brand<string, "EnrichmentJobId">
export type OperationNonce = Brand<string, "OperationNonce">
export type ProviderTurnId = Brand<string, "ProviderTurnId">
export type Sha256Digest = Brand<string, "Sha256Digest">
export type UnixMilliseconds = Brand<number, "UnixMilliseconds">
export type ImageUrl = Brand<string, "ImageUrl">
export type AssociationAttemptId = Brand<string, "AssociationAttemptId">
export type ConversationKey = Brand<string, "ConversationKey">
export type UserTurnKey = Brand<string, "UserTurnKey">
export type AssistantTurnKey = Brand<string, "AssistantTurnKey">
export type AssetIdentity = Brand<string, "AssetIdentity">
export type DocumentId = Brand<string, "DocumentId">
export type TabId = Brand<number, "TabId">
export type FrameId = Brand<number, "FrameId">

function stringBrand<Name extends string>(value: string): Brand<string, Name> {
  return value as Brand<string, Name>
}

export function promptCaptureId(value: string): PromptCaptureId {
  return stringBrand<"PromptCaptureId">(value)
}

export function imageCandidateId(value: string): ImageCandidateId {
  return stringBrand<"ImageCandidateId">(value)
}

export function enrichmentJobId(value: string): EnrichmentJobId {
  return stringBrand<"EnrichmentJobId">(value)
}

export function imageUrl(value: string): ImageUrl {
  return stringBrand<"ImageUrl">(value)
}

export function providerTurnId(value: string): ProviderTurnId {
  return stringBrand<"ProviderTurnId">(value)
}

export function sha256Digest(value: string): Sha256Digest {
  return stringBrand<"Sha256Digest">(value)
}

export function associationAttemptId(value: string): AssociationAttemptId {
  return stringBrand<"AssociationAttemptId">(value)
}

export function conversationKey(value: string): ConversationKey {
  return stringBrand<"ConversationKey">(value)
}

export function userTurnKey(value: string): UserTurnKey {
  return stringBrand<"UserTurnKey">(value)
}

export function assistantTurnKey(value: string): AssistantTurnKey {
  return stringBrand<"AssistantTurnKey">(value)
}

export function assetIdentity(value: string): AssetIdentity {
  return stringBrand<"AssetIdentity">(value)
}

export function documentId(value: string): DocumentId {
  return stringBrand<"DocumentId">(value)
}

export function tabId(value: number): TabId {
  return value as TabId
}

export function frameId(value: number): FrameId {
  return value as FrameId
}

export function unixMilliseconds(value: number): UnixMilliseconds {
  return value as UnixMilliseconds
}

export const PROVIDERS = ["chatgpt", "gemini", "grok"] as const
export type Provider = (typeof PROVIDERS)[number]

export const LIMITS = {
  maxInputBytes: 100 * 1024 * 1024,
  maxOutputBytes: 100 * 1024 * 1024,
  maxPromptUtf8Bytes: 256 * 1024,
  maxXmpBytes: 1024 * 1024,
  maxPngChunks: 10_000,
  maxImageAxisPixels: 32_768,
  maxImagePixels: 268_435_456,
  operationExpiryMilliseconds: 15 * 60 * 1000,
} as const

export type PromptCapture = {
  readonly id: PromptCaptureId
  readonly provider: Provider
  readonly originalPrompt: string
  readonly capturedAt: UnixMilliseconds
  readonly providerTurnId?: ProviderTurnId
  readonly sourceUrl?: string
}

export type ImageCandidate = {
  readonly id: ImageCandidateId
  readonly provider: Provider
  readonly sourceUrl: ImageUrl
  readonly observedAt: UnixMilliseconds
  readonly providerTurnId?: ProviderTurnId
  readonly expectedSha256?: Sha256Digest
}

export type AssociationEvidence =
  | {
      readonly kind: "provider_identity"
      readonly promptCaptureId: PromptCaptureId
      readonly imageCandidateId: ImageCandidateId
      readonly providerTurnId: ProviderTurnId
    }
  | {
      readonly kind: "explicit_confirmation"
      readonly promptCaptureId: PromptCaptureId
      readonly imageCandidateId: ImageCandidateId
      readonly confirmedAt: UnixMilliseconds
    }

export type EnrichmentError =
  | { readonly code: "unsupported_provider"; readonly provider: string }
  | { readonly code: "prompt_missing"; readonly provider: Provider }
  | { readonly code: "prompt_too_large"; readonly actualBytes: number; readonly limitBytes: number }
  | { readonly code: "image_missing"; readonly provider: Provider }
  | { readonly code: "association_ambiguous"; readonly candidateCount: number }
  | { readonly code: "confirmation_required"; readonly candidateCount: number }
  | { readonly code: "unsupported_media_type"; readonly mediaType: string }
  | { readonly code: "download_failed"; readonly status?: number }
  | { readonly code: "input_too_large"; readonly actualBytes: number; readonly limitBytes: number }
  | { readonly code: "invalid_png"; readonly reason: string }
  | { readonly code: "unsupported_png"; readonly feature: string }
  | { readonly code: "xmp_too_large"; readonly actualBytes: number; readonly limitBytes: number }
  | { readonly code: "output_too_large"; readonly actualBytes: number; readonly limitBytes: number }
  | { readonly code: "operation_expired"; readonly expiredAt: UnixMilliseconds }
  | { readonly code: "operation_cancelled" }

type EnrichmentJobBase = {
  readonly id: EnrichmentJobId
  readonly nonce: OperationNonce
  readonly promptCapture: PromptCapture
  readonly imageCandidate: ImageCandidate
  readonly association: AssociationEvidence
  readonly createdAt: UnixMilliseconds
  readonly expiresAt: UnixMilliseconds
}

export type EnrichmentJob =
  | (EnrichmentJobBase & { readonly state: "pending" })
  | (EnrichmentJobBase & { readonly state: "running"; readonly startedAt: UnixMilliseconds })
  | (EnrichmentJobBase & {
      readonly state: "succeeded"
      readonly completedAt: UnixMilliseconds
      readonly outputSha256: Sha256Digest
    })
  | (EnrichmentJobBase & {
      readonly state: "failed"
      readonly completedAt: UnixMilliseconds
      readonly error: EnrichmentError
    })
  | (EnrichmentJobBase & { readonly state: "cancelled"; readonly completedAt: UnixMilliseconds })
