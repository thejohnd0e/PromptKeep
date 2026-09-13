import type {
  AssetIdentity,
  AssistantTurnKey,
  AssociationAttemptId,
  ConversationKey,
  DocumentId,
  EnrichmentJobId,
  FrameId,
  ImageCandidate,
  PromptCapture,
  Provider,
  TabId,
  UnixMilliseconds,
  UserTurnKey,
} from "./contracts"

export type SenderDocumentIdentity = {
  readonly tabId: TabId
  readonly frameId: FrameId
  readonly documentId: DocumentId
}

export type AssociationAttempt = {
  readonly id: AssociationAttemptId
  readonly jobId: EnrichmentJobId
  readonly provider: Provider
  readonly capture: PromptCapture
  readonly conversationKey: ConversationKey
  readonly sender: SenderDocumentIdentity
  readonly openedAt: UnixMilliseconds
  readonly expiresAt: UnixMilliseconds
  readonly supersedesAttemptId?: AssociationAttemptId
}

export type NewAssociationAttempt = Omit<AssociationAttempt, "expiresAt">

export type ObservedImageCandidate = {
  readonly image: ImageCandidate
  readonly attemptId: AssociationAttemptId
  readonly conversationKey?: ConversationKey
  readonly userTurnKey?: UserTurnKey
  readonly assistantTurnKey?: AssistantTurnKey
  readonly assetIdentity?: AssetIdentity
  readonly sender: SenderDocumentIdentity
}

export type AssociationEvidence =
  | {
      readonly kind: "automatic"
      readonly conversationKey: ConversationKey
      readonly userTurnKey: UserTurnKey
      readonly assistantTurnKey: AssistantTurnKey
      readonly assetIdentity: AssetIdentity
      readonly sender: SenderDocumentIdentity
    }
  | {
      readonly kind: "explicit_confirmation"
      readonly confirmedAt: UnixMilliseconds
      readonly sender: SenderDocumentIdentity
    }

export type AssociationBinding = {
  readonly jobId: EnrichmentJobId
  readonly attemptId: AssociationAttemptId
  readonly provider: Provider
  readonly prompt: string
  readonly imageCandidate: ImageCandidate
  readonly evidence: AssociationEvidence
  readonly createdAt: UnixMilliseconds
  readonly expiresAt: UnixMilliseconds
}

export type AssociationHistory = {
  readonly completedAttemptIds: readonly AssociationAttemptId[]
  readonly supersededAttemptIds: readonly AssociationAttemptId[]
  readonly consumedAssetIdentities: readonly AssetIdentity[]
}

export type AssociationMachine =
  | ({ readonly kind: "idle" } & AssociationHistory)
  | ({ readonly kind: "awaiting"; readonly attempt: AssociationAttempt } & AssociationHistory)
  | ({ readonly kind: "ready"; readonly binding: AssociationBinding } & AssociationHistory)

export type AssociationFailure =
  | { readonly code: "ASSOCIATION_STALE" }
  | { readonly code: "ASSOCIATION_AMBIGUOUS"; readonly candidateCount: number }
  | { readonly code: "ASSOCIATION_EXPIRED"; readonly expiredAt: UnixMilliseconds }
  | { readonly code: "PROMPT_MISMATCH" }
  | { readonly code: "CONVERSATION_MISMATCH" }
  | { readonly code: "SENDER_MISMATCH"; readonly field: "tab" | "frame" | "document" }
  | { readonly code: "IMAGE_MISSING" }
  | { readonly code: "CONFIRMATION_REQUIRED"; readonly candidateCount: number }
  | { readonly code: "ASSOCIATION_DUPLICATE" }
  | { readonly code: "ASSOCIATION_CONCURRENT" }
  | { readonly code: "ASSOCIATION_SUPERSEDED" }
  | { readonly code: "ASSOCIATION_REPLAYED" }

export type OpenAssociationResult =
  | { readonly kind: "opened"; readonly state: AssociationMachine }
  | {
      readonly kind: "rejected"
      readonly state: AssociationMachine
      readonly error: AssociationFailure
    }

type RenderedTurn = {
  readonly text: string
  readonly conversationKey: ConversationKey
  readonly userTurnKey: UserTurnKey
  readonly sender: SenderDocumentIdentity
}

export type AutomaticAssociationRequest = {
  readonly kind: "automatic"
  readonly jobId: EnrichmentJobId
  readonly attemptId: AssociationAttemptId
  readonly renderedTurn: RenderedTurn
  readonly assistantTurnKey?: AssistantTurnKey
  readonly selectedAssetIdentity?: AssetIdentity
  readonly candidates: readonly ObservedImageCandidate[]
}

export type ExplicitConfirmationRequest = {
  readonly kind: "explicit_confirmation"
  readonly jobId: EnrichmentJobId
  readonly attemptId: AssociationAttemptId
  readonly renderedPrompt: string
  readonly conversationKey: ConversationKey
  readonly selectedCandidate: ObservedImageCandidate
  readonly sender: SenderDocumentIdentity
  readonly confirmedAt: UnixMilliseconds
}

export type AssociationRequest = AutomaticAssociationRequest | ExplicitConfirmationRequest
export type AssociationResult =
  | {
      readonly kind: "ready"
      readonly state: AssociationMachine
      readonly binding: AssociationBinding
    }
  | {
      readonly kind: "rejected"
      readonly state: AssociationMachine
      readonly error: AssociationFailure
    }
