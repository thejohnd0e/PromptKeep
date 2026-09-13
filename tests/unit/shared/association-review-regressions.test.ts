import { describe, expect, it } from "vitest"
import {
  type AssociationAttempt,
  associateImage,
  createAssociationAttempt,
  type ObservedImageCandidate,
  openAssociationAttempt,
} from "../../../src/shared/association"
import {
  associationAttemptId,
  conversationKey,
  documentId,
  enrichmentJobId,
  unixMilliseconds,
} from "../../../src/shared/contracts"
import {
  attempt,
  identityFreeCandidate,
  open,
  rejected,
  stableCandidate,
} from "./association-fixtures"

function confirmCandidate(active: AssociationAttempt, selectedCandidate: ObservedImageCandidate) {
  return associateImage(
    open(active),
    {
      kind: "explicit_confirmation",
      jobId: active.jobId,
      attemptId: active.id,
      renderedPrompt: active.capture.originalPrompt,
      conversationKey: active.conversationKey,
      selectedCandidate,
      sender: active.sender,
      confirmedAt: unixMilliseconds(1_150),
    },
    unixMilliseconds(1_200),
  )
}

const confirmationCases = [
  {
    name: "is absent",
    candidate: identityFreeCandidate,
  },
  {
    name: "differs from the confirmed conversation",
    candidate: (active: AssociationAttempt) => ({
      ...stableCandidate(active),
      conversationKey: conversationKey("conversation-other"),
    }),
  },
] as const

const regenerationCases = [
  {
    name: "job differs",
    attempt: (active: AssociationAttempt) =>
      createAssociationAttempt({
        ...active,
        id: associationAttemptId("attempt-regenerated"),
        jobId: enrichmentJobId("job-other"),
        supersedesAttemptId: active.id,
      }),
  },
  {
    name: "provider differs",
    attempt: (active: AssociationAttempt) =>
      createAssociationAttempt({
        ...active,
        id: associationAttemptId("attempt-regenerated"),
        provider: "grok",
        capture: { ...active.capture, provider: "grok" },
        supersedesAttemptId: active.id,
      }),
  },
  {
    name: "sender differs",
    attempt: (active: AssociationAttempt) =>
      createAssociationAttempt({
        ...active,
        id: associationAttemptId("attempt-regenerated"),
        sender: { ...active.sender, documentId: documentId("document-other") },
        supersedesAttemptId: active.id,
      }),
  },
] as const

describe("association reviewer regressions", () => {
  it("uses explicit confirmation when turn identities are unavailable", () => {
    const active = attempt()
    const candidate = {
      ...identityFreeCandidate(active),
      conversationKey: active.conversationKey,
    }

    const result = confirmCandidate(active, candidate)

    expect(result.kind).toBe("ready")
    if (result.kind === "ready") {
      expect(result.binding.evidence).toEqual({
        kind: "explicit_confirmation",
        confirmedAt: unixMilliseconds(1_150),
        sender: active.sender,
      })
      expect(result.binding.prompt).toBe("draw a fox")
    }
  })

  it.each(confirmationCases)(
    "rejects explicit confirmation when selected candidate conversation $name",
    ({ candidate }) => {
      const active = attempt()

      const result = confirmCandidate(active, candidate(active))

      expect(rejected(result).code).toBe("CONVERSATION_MISMATCH")
    },
  )

  it.each(regenerationCases)("rejects regeneration when $name", ({ attempt: nextAttempt }) => {
    const active = attempt()

    const result = openAssociationAttempt(
      open(active),
      nextAttempt(active),
      unixMilliseconds(1_100),
    )

    expect(result.kind === "rejected" ? result.error.code : result.kind).toBe(
      "ASSOCIATION_CONCURRENT",
    )
  })
})
