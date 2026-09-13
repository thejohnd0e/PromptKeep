import {
  type AssociationAttempt,
  type AssociationFailure,
  type AssociationMachine,
  type AssociationResult,
  type AutomaticAssociationRequest,
  associateImage,
  createAssociationAttempt,
  createAssociationMachine,
  type ObservedImageCandidate,
  openAssociationAttempt,
  type SenderDocumentIdentity,
} from "../../../src/shared/association"
import {
  assetIdentity,
  assistantTurnKey,
  associationAttemptId,
  conversationKey,
  documentId,
  enrichmentJobId,
  frameId,
  imageCandidateId,
  imageUrl,
  promptCaptureId,
  tabId,
  unixMilliseconds,
  userTurnKey,
} from "../../../src/shared/contracts"

export type AwaitingMachine = Extract<AssociationMachine, { readonly kind: "awaiting" }>
export type ReadyMachine = Extract<AssociationMachine, { readonly kind: "ready" }>

export class FixtureError extends Error {
  readonly name = "FixtureError"
}

export const sender: SenderDocumentIdentity = {
  tabId: tabId(7),
  frameId: frameId(0),
  documentId: documentId("document-1"),
}

export function attempt(
  id = associationAttemptId("attempt-1"),
  supersedesAttemptId?: AssociationAttempt["supersedesAttemptId"],
): AssociationAttempt {
  return createAssociationAttempt({
    id,
    jobId: enrichmentJobId("job-1"),
    provider: "chatgpt",
    capture: {
      id: promptCaptureId("capture-1"),
      provider: "chatgpt",
      originalPrompt: "draw a fox",
      capturedAt: unixMilliseconds(1_000),
    },
    conversationKey: conversationKey("conversation-1"),
    sender,
    openedAt: unixMilliseconds(1_000),
    ...(supersedesAttemptId === undefined ? {} : { supersedesAttemptId }),
  })
}

export function numberedAttempt(index: number, prompt = "draw a fox"): AssociationAttempt {
  const base = attempt(associationAttemptId(`attempt-${String(index)}`))
  return createAssociationAttempt({
    ...base,
    jobId: enrichmentJobId(`job-${String(index)}`),
    capture: {
      ...base.capture,
      id: promptCaptureId(`capture-${String(index)}`),
      originalPrompt: prompt,
    },
  })
}

export function open(attemptValue: AssociationAttempt): AssociationMachine {
  const opened = openAssociationAttempt(
    createAssociationMachine(),
    attemptValue,
    unixMilliseconds(1_001),
  )
  if (opened.kind !== "opened") {
    throw new FixtureError(`fixture did not open: ${opened.error.code}`)
  }
  return opened.state
}

export function awaiting(attemptValue: AssociationAttempt): AwaitingMachine {
  const state = open(attemptValue)
  if (state.kind !== "awaiting") {
    throw new FixtureError("fixture is not awaiting")
  }
  return state
}

export function ready(attemptValue: AssociationAttempt): ReadyMachine {
  const candidate = stableCandidate(attemptValue)
  const result = associateImage(
    awaiting(attemptValue),
    automaticRequest(attemptValue, candidate),
    unixMilliseconds(1_200),
  )
  if (result.kind !== "ready" || result.state.kind !== "ready") {
    throw new FixtureError("fixture is not ready")
  }
  return result.state
}

export function stableCandidate(
  attemptValue: AssociationAttempt,
  identity = assetIdentity("asset-1"),
  id = imageCandidateId("image-1"),
): ObservedImageCandidate {
  return {
    image: {
      id,
      provider: "chatgpt",
      sourceUrl: imageUrl("https://example.test/image.png"),
      observedAt: unixMilliseconds(1_100),
    },
    attemptId: attemptValue.id,
    conversationKey: attemptValue.conversationKey,
    userTurnKey: userTurnKey("user-turn-1"),
    assistantTurnKey: assistantTurnKey("assistant-turn-1"),
    assetIdentity: identity,
    sender,
  }
}

export function identityFreeCandidate(attemptValue: AssociationAttempt): ObservedImageCandidate {
  return {
    image: {
      id: imageCandidateId("image-unstable"),
      provider: "chatgpt",
      sourceUrl: imageUrl("https://example.test/unstable.png"),
      observedAt: unixMilliseconds(1_100),
    },
    attemptId: attemptValue.id,
    sender,
  }
}

export function automaticRequest(
  attemptValue: AssociationAttempt,
  candidate: ObservedImageCandidate,
): AutomaticAssociationRequest {
  return {
    kind: "automatic",
    jobId: attemptValue.jobId,
    attemptId: attemptValue.id,
    renderedTurn: {
      text: "draw a fox",
      conversationKey: attemptValue.conversationKey,
      userTurnKey: userTurnKey("user-turn-1"),
      sender,
    },
    assistantTurnKey: assistantTurnKey("assistant-turn-1"),
    selectedAssetIdentity: assetIdentity("asset-1"),
    candidates: [candidate],
  }
}

export function rejected(result: AssociationResult): AssociationFailure {
  if (result.kind === "ready") {
    throw new FixtureError("fixture unexpectedly became ready")
  }
  return result.error
}

export function firstCandidate(request: AutomaticAssociationRequest): ObservedImageCandidate {
  const [candidate] = request.candidates
  if (candidate === undefined) {
    throw new FixtureError("fixture has no candidate")
  }
  return candidate
}
