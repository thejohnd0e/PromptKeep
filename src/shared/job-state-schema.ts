import { z } from "zod"
import type { AssociationMachine } from "./association"
import type { AssociationAttemptId, EnrichmentJobId, UnixMilliseconds } from "./contracts"
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
  LIMITS,
  PROVIDERS,
  promptCaptureId,
  providerTurnId,
  sha256Digest,
  tabId,
  unixMilliseconds,
  userTurnKey,
} from "./contracts"

export type AwaitingAssociationMachine = Extract<AssociationMachine, { readonly kind: "awaiting" }>
export type ReadyAssociationMachine = Extract<AssociationMachine, { readonly kind: "ready" }>

export type PendingJobState = {
  readonly state: "pending"
  readonly machine: AwaitingAssociationMachine
}

export type ReadyJobState = {
  readonly state: "ready"
  readonly machine: ReadyAssociationMachine
}

export type RunningJobState = {
  readonly state: "running"
  readonly machine: ReadyAssociationMachine
  readonly startedAt: ReturnType<typeof unixMilliseconds>
}

export type ActiveJobState = PendingJobState | ReadyJobState | RunningJobState
export type StoredJobEnvelope = { readonly version: 1; readonly jobs: readonly ActiveJobState[] }

export type ActiveJobValues = {
  readonly jobId: EnrichmentJobId
  readonly attemptId: AssociationAttemptId
  readonly expiresAt: UnixMilliseconds
  readonly rawPrompt: string
}

class UnreachableStoredJobError extends Error {
  readonly name = "UnreachableStoredJobError"
}

function assertNever(value: never): never {
  throw new UnreachableStoredJobError(`unexpected stored job: ${String(value)}`)
}

export function activeJobValues(job: ActiveJobState): ActiveJobValues {
  switch (job.state) {
    case "pending":
      return {
        jobId: job.machine.attempt.jobId,
        attemptId: job.machine.attempt.id,
        expiresAt: job.machine.attempt.expiresAt,
        rawPrompt: job.machine.attempt.capture.originalPrompt,
      }
    case "ready":
    case "running":
      return {
        jobId: job.machine.binding.jobId,
        attemptId: job.machine.binding.attemptId,
        expiresAt: job.machine.binding.expiresAt,
        rawPrompt: job.machine.binding.prompt,
      }
    default:
      return assertNever(job)
  }
}

const stringId = z.string().min(1)
const attemptIdSchema = stringId.transform(associationAttemptId)
const jobIdSchema = stringId.transform(enrichmentJobId)
const conversationSchema = stringId.transform(conversationKey)
const userTurnSchema = stringId.transform(userTurnKey)
const assistantTurnSchema = stringId.transform(assistantTurnKey)
const assetSchema = stringId.transform(assetIdentity)
const timestampSchema = z.number().int().safe().nonnegative().transform(unixMilliseconds)
const providerSchema = z.enum(PROVIDERS)

const senderSchema = z.strictObject({
  tabId: z.number().int().safe().nonnegative().transform(tabId),
  frameId: z.number().int().safe().nonnegative().transform(frameId),
  documentId: stringId.transform(documentId),
})

const promptCaptureSchema = z
  .strictObject({
    id: stringId.transform(promptCaptureId),
    provider: providerSchema,
    originalPrompt: z.string(),
    capturedAt: timestampSchema,
    providerTurnId: stringId.transform(providerTurnId).exactOptional(),
  })
  .transform((value) =>
    value.providerTurnId === undefined
      ? {
          id: value.id,
          provider: value.provider,
          originalPrompt: value.originalPrompt,
          capturedAt: value.capturedAt,
        }
      : value,
  )

const imageCandidateSchema = z
  .strictObject({
    id: stringId.transform(imageCandidateId),
    provider: providerSchema,
    sourceUrl: z.url({ protocol: /^https$/ }).transform(imageUrl),
    observedAt: timestampSchema,
    providerTurnId: stringId.transform(providerTurnId).exactOptional(),
    expectedSha256: stringId.transform(sha256Digest).exactOptional(),
  })
  .transform((value) => {
    const base = {
      id: value.id,
      provider: value.provider,
      sourceUrl: value.sourceUrl,
      observedAt: value.observedAt,
    }
    return {
      ...base,
      ...(value.providerTurnId === undefined ? {} : { providerTurnId: value.providerTurnId }),
      ...(value.expectedSha256 === undefined ? {} : { expectedSha256: value.expectedSha256 }),
    }
  })

const historyShape = {
  completedAttemptIds: z.array(attemptIdSchema),
  supersededAttemptIds: z.array(attemptIdSchema),
  consumedAssetIdentities: z.array(assetSchema),
} as const

const attemptSchema = z
  .strictObject({
    id: attemptIdSchema,
    jobId: jobIdSchema,
    provider: providerSchema,
    capture: promptCaptureSchema,
    conversationKey: conversationSchema,
    sender: senderSchema,
    openedAt: timestampSchema,
    expiresAt: timestampSchema,
    supersedesAttemptId: attemptIdSchema.exactOptional(),
  })
  .transform((value) => ({
    id: value.id,
    jobId: value.jobId,
    provider: value.provider,
    capture: value.capture,
    conversationKey: value.conversationKey,
    sender: value.sender,
    openedAt: value.openedAt,
    expiresAt: value.expiresAt,
    ...(value.supersedesAttemptId === undefined
      ? {}
      : { supersedesAttemptId: value.supersedesAttemptId }),
  }))
  .refine((value) => value.expiresAt - value.openedAt === LIMITS.operationExpiryMilliseconds)

const awaitingMachineSchema = z.strictObject({
  kind: z.literal("awaiting"),
  attempt: attemptSchema,
  ...historyShape,
})

const evidenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("automatic"),
    conversationKey: conversationSchema,
    userTurnKey: userTurnSchema,
    assistantTurnKey: assistantTurnSchema,
    assetIdentity: assetSchema,
    sender: senderSchema,
  }),
  z.strictObject({
    kind: z.literal("explicit_confirmation"),
    confirmedAt: timestampSchema,
    sender: senderSchema,
  }),
])

const bindingSchema = z
  .strictObject({
    jobId: jobIdSchema,
    attemptId: attemptIdSchema,
    provider: providerSchema,
    prompt: z.string(),
    imageCandidate: imageCandidateSchema,
    evidence: evidenceSchema,
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .refine(
    (value) =>
      value.expiresAt > value.createdAt &&
      value.expiresAt - value.createdAt <= LIMITS.operationExpiryMilliseconds,
  )

const readyMachineSchema = z.strictObject({
  kind: z.literal("ready"),
  binding: bindingSchema,
  ...historyShape,
})

const activeJobSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("pending"), machine: awaitingMachineSchema }),
  z.strictObject({ state: z.literal("ready"), machine: readyMachineSchema }),
  z.strictObject({
    state: z.literal("running"),
    machine: readyMachineSchema,
    startedAt: timestampSchema,
  }),
])

const envelopeSchema = z.strictObject({ version: z.literal(1), jobs: z.array(activeJobSchema) })

export function parseStoredJobEnvelope(serialized: string): StoredJobEnvelope | undefined {
  try {
    const value: unknown = JSON.parse(serialized)
    const parsed = envelopeSchema.safeParse(value)
    return parsed.success ? parsed.data : undefined
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}
