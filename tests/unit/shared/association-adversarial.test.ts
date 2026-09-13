import { describe, expect, it } from "vitest"
import {
  associateImage,
  createAssociationAttempt,
  openAssociationAttempt,
} from "../../../src/shared/association"
import { associationAttemptId, documentId, unixMilliseconds } from "../../../src/shared/contracts"
import {
  attempt,
  automaticRequest,
  FixtureError,
  open,
  rejected,
  sender,
  stableCandidate,
} from "./association-fixtures"

describe("association identity adversaries", () => {
  it("rejects a provisional capture whose provider differs from its attempt", () => {
    const base = attempt()
    const inconsistent = createAssociationAttempt({
      ...base,
      capture: { ...base.capture, provider: "grok" },
    })

    const result = associateImage(
      open(inconsistent),
      automaticRequest(inconsistent, stableCandidate(inconsistent)),
      unixMilliseconds(1_200),
    )

    expect(rejected(result).code).toBe("ASSOCIATION_STALE")
  })

  it("accepts the current regenerated attempt but not its superseded predecessor", () => {
    const first = attempt()
    const current = attempt(associationAttemptId("attempt-2"), first.id)
    const regenerated = openAssociationAttempt(open(first), current, unixMilliseconds(1_100))
    if (regenerated.kind !== "opened") throw new FixtureError("regeneration did not open")

    const result = associateImage(
      regenerated.state,
      automaticRequest(current, stableCandidate(current)),
      unixMilliseconds(1_200),
    )

    expect(result.kind).toBe("ready")
  })

  it("rejects an image observed in another sender document", () => {
    const active = attempt()
    const candidate = {
      ...stableCandidate(active),
      sender: { ...sender, documentId: documentId("other-document") },
    }

    const result = associateImage(
      open(active),
      automaticRequest(active, candidate),
      unixMilliseconds(1_200),
    )

    expect(rejected(result)).toEqual({ code: "SENDER_MISMATCH", field: "document" })
  })

  it("reconciles canonically equivalent rendered text without fuzzy matching", () => {
    const base = attempt()
    const active = createAssociationAttempt({
      ...base,
      capture: { ...base.capture, originalPrompt: "  cafe\u0301\r\nfox\u00a0" },
    })
    const request = automaticRequest(active, stableCandidate(active))

    const result = associateImage(
      open(active),
      { ...request, renderedTurn: { ...request.renderedTurn, text: "café\nfox" } },
      unixMilliseconds(1_200),
    )

    expect(result.kind).toBe("ready")
  })
})
