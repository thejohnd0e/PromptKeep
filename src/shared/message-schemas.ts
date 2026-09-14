import { z } from "zod"
import {
  imageCandidateId,
  imageUrl,
  LIMITS,
  PROVIDERS,
  promptCaptureId,
  providerTurnId,
  sha256Digest,
  unixMilliseconds,
} from "./contracts"
import {
  MESSAGE_VERSION,
  type MessageRejection,
  NONCE_PATTERN,
  operationNonce,
} from "./message-types"

const stringId = z.string().min(1)
const timestampSchema = z.number().int().safe().nonnegative().transform(unixMilliseconds)
const providerSchema = z.enum(PROVIDERS)
const nonceSchema = z.string().regex(NONCE_PATTERN).transform(operationNonce)
const byteCountSchema = z.number().int().safe().nonnegative()

const sourceUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => value.startsWith("https://"), { message: "sourceUrl must be https" })

const promptCaptureSchema = z
  .strictObject({
    id: stringId.transform(promptCaptureId),
    provider: providerSchema,
    originalPrompt: z.string(),
    capturedAt: timestampSchema,
    providerTurnId: stringId.transform(providerTurnId).exactOptional(),
    sourceUrl: sourceUrlSchema.exactOptional(),
  })
  .refine(
    (value) =>
      new TextEncoder().encode(value.originalPrompt).byteLength <= LIMITS.maxPromptUtf8Bytes,
    { message: "prompt exceeds maxPromptUtf8Bytes" },
  )
  .transform((value) => ({
    id: value.id,
    provider: value.provider,
    originalPrompt: value.originalPrompt,
    capturedAt: value.capturedAt,
    ...(value.providerTurnId === undefined ? {} : { providerTurnId: value.providerTurnId }),
    ...(value.sourceUrl === undefined ? {} : { sourceUrl: value.sourceUrl }),
  }))

function isForbiddenUrlHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true
  if (hostname === "0.0.0.0" || hostname === "127.0.0.1" || hostname === "::1") return true
  if (/^127\./u.test(hostname) || /^10\./u.test(hostname) || /^192\.168\./u.test(hostname)) {
    return true
  }
  if (/^169\.254\./u.test(hostname)) return true
  return /^172\.(1[6-9]|2\d|3[01])\./u.test(hostname)
}

const imageCandidateSchema = z
  .strictObject({
    id: stringId.transform(imageCandidateId),
    provider: providerSchema,
    sourceUrl: z.url({ protocol: /^https$/ }).transform(imageUrl),
    observedAt: timestampSchema,
    providerTurnId: stringId.transform(providerTurnId).exactOptional(),
    expectedSha256: stringId.transform(sha256Digest).exactOptional(),
  })
  .refine(
    (value) => {
      try {
        return !isForbiddenUrlHost(new URL(value.sourceUrl).hostname)
      } catch {
        return false
      }
    },
    { message: "forbidden URL host" },
  )
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

const enrichmentErrorSchema = z.discriminatedUnion("code", [
  z.strictObject({ code: z.literal("unsupported_provider"), provider: z.string() }),
  z.strictObject({ code: z.literal("prompt_missing"), provider: providerSchema }),
  z.strictObject({
    code: z.literal("prompt_too_large"),
    actualBytes: byteCountSchema,
    limitBytes: byteCountSchema,
  }),
  z.strictObject({ code: z.literal("image_missing"), provider: providerSchema }),
  z.strictObject({
    code: z.literal("association_ambiguous"),
    candidateCount: byteCountSchema,
  }),
  z.strictObject({
    code: z.literal("confirmation_required"),
    candidateCount: byteCountSchema,
  }),
  z.strictObject({ code: z.literal("unsupported_media_type"), mediaType: z.string() }),
  z.strictObject({
    code: z.literal("download_failed"),
    status: byteCountSchema.exactOptional(),
  }),
  z.strictObject({
    code: z.literal("input_too_large"),
    actualBytes: byteCountSchema,
    limitBytes: byteCountSchema,
  }),
  z.strictObject({ code: z.literal("invalid_png"), reason: z.string() }),
  z.strictObject({ code: z.literal("unsupported_png"), feature: z.string() }),
  z.strictObject({
    code: z.literal("xmp_too_large"),
    actualBytes: byteCountSchema,
    limitBytes: byteCountSchema,
  }),
  z.strictObject({
    code: z.literal("output_too_large"),
    actualBytes: byteCountSchema,
    limitBytes: byteCountSchema,
  }),
  z.strictObject({ code: z.literal("operation_expired"), expiredAt: timestampSchema }),
  z.strictObject({ code: z.literal("operation_cancelled") }),
])

const messageRejectionSchema = z.discriminatedUnion("code", [
  z.strictObject({ code: z.literal("MESSAGE_NOT_OBJECT") }),
  z.strictObject({ code: z.literal("MESSAGE_UNKNOWN_VERSION") }),
  z.strictObject({ code: z.literal("MESSAGE_UNKNOWN_TYPE") }),
  z.strictObject({ code: z.literal("MESSAGE_SCHEMA_MISMATCH"), reason: z.string() }),
  z.strictObject({ code: z.literal("MESSAGE_NONCE_EXPIRED"), expiredAt: timestampSchema }),
  z.strictObject({ code: z.literal("SENDER_RUNTIME_ID_MISMATCH") }),
  z.strictObject({ code: z.literal("SENDER_URL_MISSING") }),
  z.strictObject({ code: z.literal("SENDER_ORIGIN_NOT_ALLOWED") }),
])

const initiateOperationSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  type: z.literal("initiate_operation"),
  nonce: nonceSchema,
  createdAt: timestampSchema,
  promptCapture: promptCaptureSchema,
  imageCandidate: imageCandidateSchema,
})

const operationAcceptedSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  type: z.literal("operation_accepted"),
  nonce: nonceSchema,
})

const operationRejectedSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  type: z.literal("operation_rejected"),
  nonce: nonceSchema,
  error: enrichmentErrorSchema,
})

const messageRejectedSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  type: z.literal("message_rejected"),
  reason: messageRejectionSchema,
})

const offscreenJobSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  type: z.literal("offscreen_job"),
  nonce: nonceSchema,
  providerSystemLabel: z.string().min(1),
  prompt: z.string(),
  sourceUrl: sourceUrlSchema.exactOptional(),
})

const offscreenAckSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  type: z.literal("offscreen_ack"),
  nonce: nonceSchema,
  blobUrl: z.string().startsWith("blob:"),
})

const offscreenRevokeSchema = z.strictObject({
  version: z.literal(MESSAGE_VERSION),
  type: z.literal("offscreen_revoke"),
  nonce: nonceSchema,
  blobUrl: z.string().startsWith("blob:"),
})

const statusNotificationSchema = z.discriminatedUnion("status", [
  z.strictObject({
    version: z.literal(MESSAGE_VERSION),
    type: z.literal("status_notification"),
    nonce: nonceSchema,
    status: z.literal("started"),
  }),
  z.strictObject({
    version: z.literal(MESSAGE_VERSION),
    type: z.literal("status_notification"),
    nonce: nonceSchema,
    status: z.literal("completed"),
  }),
  z.strictObject({
    version: z.literal(MESSAGE_VERSION),
    type: z.literal("status_notification"),
    nonce: nonceSchema,
    status: z.literal("failed"),
    error: enrichmentErrorSchema,
  }),
])

const messageSchemas = {
  initiate_operation: initiateOperationSchema,
  operation_accepted: operationAcceptedSchema,
  operation_rejected: operationRejectedSchema,
  message_rejected: messageRejectedSchema,
  offscreen_job: offscreenJobSchema,
  offscreen_ack: offscreenAckSchema,
  offscreen_revoke: offscreenRevokeSchema,
  status_notification: statusNotificationSchema,
} as const

export type TypedParseResult<Message> =
  | { readonly kind: "ok"; readonly message: Message }
  | { readonly kind: "rejected"; readonly error: MessageRejection }

export function parseWith<Message>(
  schema: z.ZodType<Message>,
  value: unknown,
): TypedParseResult<Message> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    return {
      kind: "rejected",
      error: { code: "MESSAGE_SCHEMA_MISMATCH", reason: parsed.error.message },
    }
  }
  return { kind: "ok", message: parsed.data }
}

export { messageSchemas }
