import { LIMITS, unixMilliseconds } from "./contracts"
import { messageSchemas, parseWith } from "./message-schemas"
import {
  ALLOWED_CONTENT_ORIGINS,
  MESSAGE_VERSION,
  type MessageParseResult,
  type MessageSender,
  OFFSCREEN_DOCUMENT_PATH,
  type SenderValidationResult,
  type UnixMilliseconds,
} from "./message-types"

export type {
  ContentResponse,
  ExtensionMessage,
  InitiateOperationMessage,
  MessageParseResult,
  MessageRejectedMessage,
  MessageRejection,
  MessageSender,
  OffscreenAckMessage,
  OffscreenJobMessage,
  OffscreenRevokeMessage,
  OperationAcceptedMessage,
  OperationRejectedMessage,
  SenderRejection,
  SenderValidationResult,
  StatusNotificationMessage,
} from "./message-types"
export {
  ALLOWED_CONTENT_ORIGINS,
  MESSAGE_VERSION,
  OFFSCREEN_DOCUMENT_PATH,
  operationNonce,
} from "./message-types"

export function parseInboundMessage(value: unknown, now: UnixMilliseconds): MessageParseResult {
  if (typeof value !== "object" || value === null) {
    return { kind: "rejected", error: { code: "MESSAGE_NOT_OBJECT" } }
  }
  const record = value as Record<string, unknown>
  if (record["version"] !== MESSAGE_VERSION) {
    return { kind: "rejected", error: { code: "MESSAGE_UNKNOWN_VERSION" } }
  }
  const type = record["type"]
  if (typeof type !== "string") {
    return { kind: "rejected", error: { code: "MESSAGE_UNKNOWN_TYPE" } }
  }
  switch (type) {
    case "initiate_operation": {
      const parsed = parseWith(messageSchemas.initiate_operation, value)
      if (parsed.kind === "rejected") return parsed
      const expiredAt = unixMilliseconds(
        parsed.message.createdAt + LIMITS.operationExpiryMilliseconds,
      )
      if (now >= expiredAt) {
        return { kind: "rejected", error: { code: "MESSAGE_NONCE_EXPIRED", expiredAt } }
      }
      return { kind: "ok", message: parsed.message }
    }
    case "operation_accepted":
      return parseWith(messageSchemas.operation_accepted, value)
    case "operation_rejected":
      return parseWith(messageSchemas.operation_rejected, value)
    case "message_rejected":
      return parseWith(messageSchemas.message_rejected, value)
    case "offscreen_job":
      return parseWith(messageSchemas.offscreen_job, value)
    case "offscreen_ack":
      return parseWith(messageSchemas.offscreen_ack, value)
    case "offscreen_revoke":
      return parseWith(messageSchemas.offscreen_revoke, value)
    case "status_notification":
      return parseWith(messageSchemas.status_notification, value)
    default:
      return { kind: "rejected", error: { code: "MESSAGE_UNKNOWN_TYPE" } }
  }
}

function isAllowedContentOrigin(url: string): boolean {
  try {
    return ALLOWED_CONTENT_ORIGINS.some((origin) => new URL(url).origin === origin)
  } catch {
    return false
  }
}

function isOffscreenDocumentUrl(url: string, runtimeId: string): boolean {
  return url === `chrome-extension://${runtimeId}/${OFFSCREEN_DOCUMENT_PATH}`
}

export function validateMessageSender(
  sender: MessageSender,
  runtimeId: string,
): SenderValidationResult {
  if (sender.id !== runtimeId) {
    return { kind: "rejected", error: { code: "SENDER_RUNTIME_ID_MISMATCH" } }
  }
  const url = sender.url
  if (url === undefined) {
    return { kind: "rejected", error: { code: "SENDER_URL_MISSING" } }
  }
  if (isOffscreenDocumentUrl(url, runtimeId)) {
    return { kind: "ok", origin: "offscreen" }
  }
  if (isAllowedContentOrigin(url)) {
    return { kind: "ok", origin: "content" }
  }
  return { kind: "rejected", error: { code: "SENDER_ORIGIN_NOT_ALLOWED" } }
}
