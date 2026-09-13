import type {
  AssociationAttempt,
  AssociationBinding,
  AssociationFailure,
  AssociationHistory,
  AssociationMachine,
  AssociationRequest,
  AssociationResult,
  AutomaticAssociationRequest,
  ExplicitConfirmationRequest,
  NewAssociationAttempt,
  OpenAssociationResult,
} from "./association-types"
import {
  reconcileAttempt,
  resolveActiveAttempt,
  selectAutomaticCandidate,
  senderFailure,
} from "./association-validation"
import type { UnixMilliseconds } from "./contracts"
import { LIMITS, unixMilliseconds } from "./contracts"

export type {
  AssociationAttempt,
  AssociationBinding,
  AssociationEvidence,
  AssociationFailure,
  AssociationMachine,
  AssociationRequest,
  AssociationResult,
  AutomaticAssociationRequest,
  ExplicitConfirmationRequest,
  NewAssociationAttempt,
  ObservedImageCandidate,
  OpenAssociationResult,
  SenderDocumentIdentity,
} from "./association-types"
export { normalizePromptText } from "./association-validation"

class UnreachableAssociationError extends Error {
  readonly name = "UnreachableAssociationError"
}

function assertNever(value: never): never {
  throw new UnreachableAssociationError(`unexpected association variant: ${String(value)}`)
}

function history(state: AssociationMachine): AssociationHistory {
  return {
    completedAttemptIds: state.completedAttemptIds,
    supersededAttemptIds: state.supersededAttemptIds,
    consumedAssetIdentities: state.consumedAssetIdentities,
  }
}

export function createAssociationAttempt(input: NewAssociationAttempt): AssociationAttempt {
  return {
    ...input,
    expiresAt: unixMilliseconds(input.openedAt + LIMITS.operationExpiryMilliseconds),
  }
}

export function createAssociationMachine(): AssociationMachine {
  return {
    kind: "idle",
    completedAttemptIds: [],
    supersededAttemptIds: [],
    consumedAssetIdentities: [],
  }
}

export function openAssociationAttempt(
  state: AssociationMachine,
  attempt: AssociationAttempt,
  now: UnixMilliseconds,
): OpenAssociationResult {
  if (now >= attempt.expiresAt) {
    return {
      kind: "rejected",
      state,
      error: { code: "ASSOCIATION_EXPIRED", expiredAt: attempt.expiresAt },
    }
  }
  if (state.completedAttemptIds.includes(attempt.id)) {
    return { kind: "rejected", state, error: { code: "ASSOCIATION_REPLAYED" } }
  }
  if (state.supersededAttemptIds.includes(attempt.id)) {
    return { kind: "rejected", state, error: { code: "ASSOCIATION_SUPERSEDED" } }
  }
  switch (state.kind) {
    case "idle":
      return { kind: "opened", state: { kind: "awaiting", attempt, ...history(state) } }
    case "awaiting":
      if (state.attempt.id === attempt.id) {
        return { kind: "rejected", state, error: { code: "ASSOCIATION_DUPLICATE" } }
      }
      if (
        attempt.supersedesAttemptId !== state.attempt.id ||
        attempt.jobId !== state.attempt.jobId ||
        attempt.provider !== state.attempt.provider ||
        senderFailure(state.attempt.sender, attempt.sender) !== undefined
      ) {
        return { kind: "rejected", state, error: { code: "ASSOCIATION_CONCURRENT" } }
      }
      return {
        kind: "opened",
        state: {
          kind: "awaiting",
          attempt,
          ...history(state),
          supersededAttemptIds: [...state.supersededAttemptIds, state.attempt.id],
        },
      }
    case "ready":
      return { kind: "rejected", state, error: { code: "ASSOCIATION_CONCURRENT" } }
    default:
      return assertNever(state)
  }
}

function reject(state: AssociationMachine, error: AssociationFailure): AssociationResult {
  return { kind: "rejected", state, error }
}

function complete(
  state: AssociationMachine,
  attempt: AssociationAttempt,
  binding: AssociationBinding,
): AssociationResult {
  const consumed = binding.evidence.kind === "automatic" ? [binding.evidence.assetIdentity] : []
  const readyState: AssociationMachine = {
    kind: "ready",
    binding,
    ...history(state),
    completedAttemptIds: [...state.completedAttemptIds, attempt.id],
    consumedAssetIdentities: [...state.consumedAssetIdentities, ...consumed],
  }
  return { kind: "ready", state: readyState, binding }
}

type ActiveAssociationContext = {
  readonly state: AssociationMachine
  readonly attempt: AssociationAttempt
  readonly now: UnixMilliseconds
}

function automatic(
  context: ActiveAssociationContext,
  request: AutomaticAssociationRequest,
): AssociationResult {
  const { attempt, now, state } = context
  const commonError = reconcileAttempt(attempt, {
    prompt: request.renderedTurn.text,
    conversationKey: request.renderedTurn.conversationKey,
    sender: request.renderedTurn.sender,
  })
  if (commonError !== undefined) return reject(context.state, commonError)
  const selection = selectAutomaticCandidate(attempt, request)
  if (selection.kind === "rejected") return reject(state, selection.error)
  const binding: AssociationBinding = {
    jobId: attempt.jobId,
    attemptId: attempt.id,
    provider: attempt.provider,
    prompt: request.renderedTurn.text,
    imageCandidate: selection.candidate.image,
    evidence: {
      kind: "automatic",
      conversationKey: request.renderedTurn.conversationKey,
      userTurnKey: request.renderedTurn.userTurnKey,
      assistantTurnKey: selection.assistantTurnKey,
      assetIdentity: selection.assetIdentity,
      sender: request.renderedTurn.sender,
    },
    createdAt: now,
    expiresAt: attempt.expiresAt,
  }
  return complete(state, attempt, binding)
}

function confirm(
  context: ActiveAssociationContext,
  request: ExplicitConfirmationRequest,
): AssociationResult {
  const { attempt, now, state } = context
  const commonError = reconcileAttempt(attempt, {
    prompt: request.renderedPrompt,
    conversationKey: request.conversationKey,
    sender: request.sender,
  })
  if (commonError !== undefined) return reject(context.state, commonError)
  if (request.selectedCandidate.conversationKey !== request.conversationKey) {
    return reject(state, { code: "CONVERSATION_MISMATCH" })
  }
  const candidateSenderError = senderFailure(attempt.sender, request.selectedCandidate.sender)
  if (candidateSenderError !== undefined) return reject(state, candidateSenderError)
  if (
    request.selectedCandidate.attemptId !== attempt.id ||
    request.selectedCandidate.image.provider !== attempt.provider
  ) {
    return reject(state, { code: "ASSOCIATION_STALE" })
  }
  return complete(state, attempt, {
    jobId: attempt.jobId,
    attemptId: attempt.id,
    provider: attempt.provider,
    prompt: request.renderedPrompt,
    imageCandidate: request.selectedCandidate.image,
    evidence: {
      kind: "explicit_confirmation",
      confirmedAt: request.confirmedAt,
      sender: request.sender,
    },
    createdAt: now,
    expiresAt: attempt.expiresAt,
  })
}

export function associateImage(
  state: AssociationMachine,
  request: AssociationRequest,
  now: UnixMilliseconds,
): AssociationResult {
  const active = resolveActiveAttempt(
    state,
    { jobId: request.jobId, attemptId: request.attemptId },
    now,
  )
  if (active.kind === "rejected") return active
  switch (request.kind) {
    case "automatic":
      return automatic({ state, attempt: active.attempt, now }, request)
    case "explicit_confirmation":
      return confirm({ state, attempt: active.attempt, now }, request)
    default:
      return assertNever(request)
  }
}
