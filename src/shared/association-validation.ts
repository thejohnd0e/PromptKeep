import type {
  AssociationAttempt,
  AssociationFailure,
  AssociationMachine,
  AutomaticAssociationRequest,
  ObservedImageCandidate,
  SenderDocumentIdentity,
} from "./association-types"
import type {
  AssetIdentity,
  AssistantTurnKey,
  AssociationAttemptId,
  ConversationKey,
  EnrichmentJobId,
  UnixMilliseconds,
} from "./contracts"

type ReconciliationInput = {
  readonly prompt: string
  readonly conversationKey: ConversationKey
  readonly sender: SenderDocumentIdentity
}

type AutomaticCandidateResult =
  | {
      readonly kind: "selected"
      readonly candidate: ObservedImageCandidate
      readonly assetIdentity: AssetIdentity
      readonly assistantTurnKey: AssistantTurnKey
    }
  | { readonly kind: "rejected"; readonly error: AssociationFailure }

type ActiveAttemptResult =
  | { readonly kind: "active"; readonly attempt: AssociationAttempt }
  | {
      readonly kind: "rejected"
      readonly state: AssociationMachine
      readonly error: AssociationFailure
    }

type AssociationOperationIdentity = {
  readonly jobId: EnrichmentJobId
  readonly attemptId: AssociationAttemptId
}

class UnreachableAssociationStateError extends Error {
  readonly name = "UnreachableAssociationStateError"
}

function assertNever(value: never): never {
  throw new UnreachableAssociationStateError(`unexpected association state: ${String(value)}`)
}

function belongsToJob(state: AssociationMachine, jobId: EnrichmentJobId): boolean {
  switch (state.kind) {
    case "idle":
      return true
    case "awaiting":
      return state.attempt.jobId === jobId
    case "ready":
      return state.binding.jobId === jobId
    default:
      return assertNever(state)
  }
}

export function normalizePromptText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?|\u2028|\u2029/gu, "\n")
    .replaceAll("\u00a0", " ")
    .trim()
}

export function senderFailure(
  expected: SenderDocumentIdentity,
  actual: SenderDocumentIdentity,
): AssociationFailure | undefined {
  if (expected.tabId !== actual.tabId) return { code: "SENDER_MISMATCH", field: "tab" }
  if (expected.frameId !== actual.frameId) return { code: "SENDER_MISMATCH", field: "frame" }
  if (expected.documentId !== actual.documentId) {
    return { code: "SENDER_MISMATCH", field: "document" }
  }
  return undefined
}

export function reconcileAttempt(
  attempt: AssociationAttempt,
  input: ReconciliationInput,
): AssociationFailure | undefined {
  if (attempt.capture.provider !== attempt.provider) return { code: "ASSOCIATION_STALE" }
  const senderError = senderFailure(attempt.sender, input.sender)
  if (senderError !== undefined) return senderError
  if (attempt.conversationKey !== input.conversationKey) return { code: "CONVERSATION_MISMATCH" }
  if (normalizePromptText(attempt.capture.originalPrompt) !== normalizePromptText(input.prompt)) {
    return { code: "PROMPT_MISMATCH" }
  }
  return undefined
}

export function resolveActiveAttempt(
  state: AssociationMachine,
  identity: AssociationOperationIdentity,
  now: UnixMilliseconds,
): ActiveAttemptResult {
  if (!belongsToJob(state, identity.jobId)) {
    return { kind: "rejected", state, error: { code: "ASSOCIATION_STALE" } }
  }
  if (state.supersededAttemptIds.includes(identity.attemptId)) {
    return { kind: "rejected", state, error: { code: "ASSOCIATION_SUPERSEDED" } }
  }
  if (state.completedAttemptIds.includes(identity.attemptId)) {
    return { kind: "rejected", state, error: { code: "ASSOCIATION_REPLAYED" } }
  }
  switch (state.kind) {
    case "idle":
      return { kind: "rejected", state, error: { code: "ASSOCIATION_STALE" } }
    case "ready":
      return { kind: "rejected", state, error: { code: "ASSOCIATION_REPLAYED" } }
    case "awaiting":
      if (state.attempt.id !== identity.attemptId) {
        return { kind: "rejected", state, error: { code: "ASSOCIATION_STALE" } }
      }
      if (now >= state.attempt.expiresAt) {
        return {
          kind: "rejected",
          state: {
            kind: "idle",
            completedAttemptIds: state.completedAttemptIds,
            supersededAttemptIds: state.supersededAttemptIds,
            consumedAssetIdentities: state.consumedAssetIdentities,
          },
          error: { code: "ASSOCIATION_EXPIRED", expiredAt: state.attempt.expiresAt },
        }
      }
      return { kind: "active", attempt: state.attempt }
    default:
      return assertNever(state)
  }
}

export function selectAutomaticCandidate(
  attempt: AssociationAttempt,
  request: AutomaticAssociationRequest,
): AutomaticCandidateResult {
  if (request.candidates.length === 0) return { kind: "rejected", error: { code: "IMAGE_MISSING" } }
  if (request.candidates.length > 1 && request.selectedAssetIdentity === undefined) {
    return {
      kind: "rejected",
      error: { code: "ASSOCIATION_AMBIGUOUS", candidateCount: request.candidates.length },
    }
  }
  if (request.selectedAssetIdentity === undefined || request.assistantTurnKey === undefined) {
    return {
      kind: "rejected",
      error: { code: "CONFIRMATION_REQUIRED", candidateCount: request.candidates.length },
    }
  }
  const matches = request.candidates.filter(
    (candidate) => candidate.assetIdentity === request.selectedAssetIdentity,
  )
  if (matches.length > 1) return { kind: "rejected", error: { code: "ASSOCIATION_DUPLICATE" } }
  const [candidate] = matches
  if (candidate === undefined) {
    const hasStableIdentity = request.candidates.every((value) => value.assetIdentity !== undefined)
    if (!hasStableIdentity && request.candidates.length > 1) {
      return {
        kind: "rejected",
        error: { code: "ASSOCIATION_AMBIGUOUS", candidateCount: request.candidates.length },
      }
    }
    return {
      kind: "rejected",
      error: hasStableIdentity
        ? { code: "ASSOCIATION_STALE" }
        : { code: "CONFIRMATION_REQUIRED", candidateCount: request.candidates.length },
    }
  }
  const candidateSenderError = senderFailure(attempt.sender, candidate.sender)
  if (candidateSenderError !== undefined) return { kind: "rejected", error: candidateSenderError }
  if (
    candidate.attemptId !== attempt.id ||
    candidate.image.provider !== attempt.provider ||
    candidate.conversationKey !== attempt.conversationKey ||
    candidate.userTurnKey !== request.renderedTurn.userTurnKey ||
    candidate.assistantTurnKey !== request.assistantTurnKey
  ) {
    return { kind: "rejected", error: { code: "ASSOCIATION_STALE" } }
  }
  return {
    kind: "selected",
    candidate,
    assetIdentity: request.selectedAssetIdentity,
    assistantTurnKey: request.assistantTurnKey,
  }
}
