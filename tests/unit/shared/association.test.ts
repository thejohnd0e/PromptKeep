import { describe, expect, it } from "vitest"
import {
  type AutomaticAssociationRequest,
  associateImage,
  createAssociationAttempt,
  normalizePromptText,
  openAssociationAttempt,
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
  tabId,
  unixMilliseconds,
  userTurnKey,
} from "../../../src/shared/contracts"
import {
  attempt,
  automaticRequest,
  FixtureError,
  firstCandidate,
  identityFreeCandidate,
  open,
  rejected,
  sender,
  stableCandidate,
} from "./association-fixtures"

describe("fail-closed association", () => {
  it("creates one deterministic pair when every stable identity agrees", () => {
    // Given
    const activeAttempt = attempt()
    const candidate = stableCandidate(activeAttempt)

    // When
    const result = associateImage(
      open(activeAttempt),
      automaticRequest(activeAttempt, candidate),
      unixMilliseconds(1_200),
    )

    // Then
    expect(result.kind).toBe("ready")
    if (result.kind === "ready") {
      expect(result.binding).toMatchObject({
        jobId: enrichmentJobId("job-1"),
        attemptId: associationAttemptId("attempt-1"),
        prompt: "draw a fox",
        imageCandidate: candidate.image,
        evidence: {
          kind: "automatic",
          conversationKey: conversationKey("conversation-1"),
          userTurnKey: userTurnKey("user-turn-1"),
          assistantTurnKey: assistantTurnKey("assistant-turn-1"),
          assetIdentity: assetIdentity("asset-1"),
          sender,
        },
      })
    }
  })

  it("normalizes only Unicode, line endings, non-breaking spaces, and edge whitespace", () => {
    expect(normalizePromptText("  cafe\u0301\r\nfox\u00a0  ")).toBe("café\nfox")
  })

  it("requires exact prompt equality after deterministic normalization", () => {
    const activeAttempt = createAssociationAttempt({
      ...attempt(),
      capture: { ...attempt().capture, originalPrompt: "draw  a fox" },
    })
    const request = automaticRequest(activeAttempt, stableCandidate(activeAttempt))
    const result = associateImage(
      open(activeAttempt),
      { ...request, renderedTurn: { ...request.renderedTurn, text: "draw a fox" } },
      unixMilliseconds(1_200),
    )

    expect(rejected(result).code).toBe("PROMPT_MISMATCH")
  })

  it("selects one of two images only by its stable asset identity", () => {
    const activeAttempt = attempt()
    const selected = stableCandidate(activeAttempt)
    const other = stableCandidate(
      activeAttempt,
      assetIdentity("asset-2"),
      imageCandidateId("image-2"),
    )
    const request = { ...automaticRequest(activeAttempt, selected), candidates: [selected, other] }

    const result = associateImage(open(activeAttempt), request, unixMilliseconds(1_200))

    expect(result.kind === "ready" ? result.binding.imageCandidate.id : result.error.code).toBe(
      imageCandidateId("image-1"),
    )
  })

  it("rejects equal-timestamp candidates without stable identity as ambiguous", () => {
    const activeAttempt = attempt()
    const first = identityFreeCandidate(activeAttempt)
    const second = { ...first, image: { ...first.image, id: imageCandidateId("image-2") } }
    const request = automaticRequest(activeAttempt, first)

    const result = associateImage(
      open(activeAttempt),
      { ...request, candidates: [first, second] },
      unixMilliseconds(1_200),
    )

    expect(rejected(result)).toEqual({ code: "ASSOCIATION_AMBIGUOUS", candidateCount: 2 })
    expect(result.state.kind).toBe("awaiting")
  })

  it.each([
    [{ ...sender, tabId: tabId(8) }, "tab"],
    [{ ...sender, frameId: frameId(1) }, "frame"],
    [{ ...sender, documentId: documentId("document-2") }, "document"],
  ] as const)("rejects a cross-%s sender document tuple", (otherSender, field) => {
    const activeAttempt = attempt()
    const request = automaticRequest(activeAttempt, stableCandidate(activeAttempt))

    const result = associateImage(
      open(activeAttempt),
      { ...request, renderedTurn: { ...request.renderedTurn, sender: otherSender } },
      unixMilliseconds(1_200),
    )

    expect(rejected(result)).toMatchObject({ code: "SENDER_MISMATCH", field })
  })

  it.each([
    [
      "conversation navigation",
      (value: AutomaticAssociationRequest) => ({
        ...value,
        renderedTurn: {
          ...value.renderedTurn,
          conversationKey: conversationKey("conversation-2"),
        },
      }),
      "CONVERSATION_MISMATCH",
    ],
    [
      "cross-job request",
      (value: AutomaticAssociationRequest) => ({ ...value, jobId: enrichmentJobId("job-2") }),
      "ASSOCIATION_STALE",
    ],
    [
      "missing image",
      (value: AutomaticAssociationRequest) => ({ ...value, candidates: [] }),
      "IMAGE_MISSING",
    ],
    [
      "proximity or timestamp only",
      (value: AutomaticAssociationRequest) => ({
        ...value,
        candidates: [identityFreeCandidate(attempt())],
      }),
      "CONFIRMATION_REQUIRED",
    ],
    [
      "stale generation candidate",
      (value: AutomaticAssociationRequest) => ({
        ...value,
        candidates: [{ ...firstCandidate(value), attemptId: associationAttemptId("attempt-old") }],
      }),
      "ASSOCIATION_STALE",
    ],
    [
      "duplicate asset observations",
      (value: AutomaticAssociationRequest) => ({
        ...value,
        candidates: [firstCandidate(value), firstCandidate(value)],
      }),
      "ASSOCIATION_DUPLICATE",
    ],
  ] as const)("fails closed for %s", (_case, change, code) => {
    const activeAttempt = attempt()
    const request = change(automaticRequest(activeAttempt, stableCandidate(activeAttempt)))

    const result = associateImage(open(activeAttempt), request, unixMilliseconds(1_200))

    expect(rejected(result).code).toBe(code)
  })

  it("rejects duplicate and concurrent attempt openings", () => {
    const activeAttempt = attempt()
    const active = open(activeAttempt)
    const duplicate = openAssociationAttempt(active, activeAttempt, unixMilliseconds(1_100))
    const concurrent = openAssociationAttempt(
      active,
      attempt(associationAttemptId("attempt-2")),
      unixMilliseconds(1_100),
    )

    expect(duplicate.kind === "rejected" ? duplicate.error.code : duplicate.kind).toBe(
      "ASSOCIATION_DUPLICATE",
    )
    expect(concurrent.kind === "rejected" ? concurrent.error.code : concurrent.kind).toBe(
      "ASSOCIATION_CONCURRENT",
    )
  })

  it("supersedes a regenerated attempt and rejects the old attempt", () => {
    const first = attempt()
    const second = attempt(associationAttemptId("attempt-2"), first.id)
    const regenerated = openAssociationAttempt(open(first), second, unixMilliseconds(1_100))
    if (regenerated.kind !== "opened") {
      throw new FixtureError("regenerated attempt did not open")
    }

    const result = associateImage(
      regenerated.state,
      automaticRequest(first, stableCandidate(first)),
      unixMilliseconds(1_200),
    )

    expect(rejected(result).code).toBe("ASSOCIATION_SUPERSEDED")
  })

  it("rejects replay after an attempt becomes ready", () => {
    const activeAttempt = attempt()
    const request = automaticRequest(activeAttempt, stableCandidate(activeAttempt))
    const first = associateImage(open(activeAttempt), request, unixMilliseconds(1_200))
    if (first.kind !== "ready") {
      throw new FixtureError("first association did not become ready")
    }

    const replay = associateImage(first.state, request, unixMilliseconds(1_201))

    expect(rejected(replay).code).toBe("ASSOCIATION_REPLAYED")
  })

  it("expires opportunistically and leaves no ready attempt", () => {
    const activeAttempt = attempt()

    const result = associateImage(
      open(activeAttempt),
      automaticRequest(activeAttempt, stableCandidate(activeAttempt)),
      activeAttempt.expiresAt,
    )

    expect(rejected(result)).toEqual({
      code: "ASSOCIATION_EXPIRED",
      expiredAt: activeAttempt.expiresAt,
    })
    expect(result.state.kind).toBe("idle")
  })
})
