import type {
  EnrichmentError,
  ImageCandidate,
  OperationNonce,
  PromptCapture,
  UnixMilliseconds,
} from "./contracts"

export const MESSAGE_VERSION = 1 as const
export const ALLOWED_CONTENT_ORIGINS = [
  "https://chatgpt.com",
  "https://gemini.google.com",
  "https://grok.com",
] as const
export const OFFSCREEN_DOCUMENT_PATH = "offscreen.html" as const

const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u

export function operationNonce(value: string): OperationNonce {
  return value as OperationNonce
}

export type InitiateOperationMessage = {
  readonly version: typeof MESSAGE_VERSION
  readonly type: "initiate_operation"
  readonly nonce: OperationNonce
  readonly createdAt: UnixMilliseconds
  readonly promptCapture: PromptCapture
  readonly imageCandidate: ImageCandidate
}

export type OperationAcceptedMessage = {
  readonly version: typeof MESSAGE_VERSION
  readonly type: "operation_accepted"
  readonly nonce: OperationNonce
}

export type OperationRejectedMessage = {
  readonly version: typeof MESSAGE_VERSION
  readonly type: "operation_rejected"
  readonly nonce: OperationNonce
  readonly error: EnrichmentError
}

export type MessageRejection =
  | { readonly code: "MESSAGE_NOT_OBJECT" }
  | { readonly code: "MESSAGE_UNKNOWN_VERSION" }
  | { readonly code: "MESSAGE_UNKNOWN_TYPE" }
  | { readonly code: "MESSAGE_SCHEMA_MISMATCH"; readonly reason: string }
  | { readonly code: "MESSAGE_NONCE_EXPIRED"; readonly expiredAt: UnixMilliseconds }
  | { readonly code: "SENDER_RUNTIME_ID_MISMATCH" }
  | { readonly code: "SENDER_URL_MISSING" }
  | { readonly code: "SENDER_ORIGIN_NOT_ALLOWED" }

export type MessageRejectedMessage = {
  readonly version: typeof MESSAGE_VERSION
  readonly type: "message_rejected"
  readonly reason: MessageRejection
}

export type OffscreenJobMessage = {
  readonly version: typeof MESSAGE_VERSION
  readonly type: "offscreen_job"
  readonly nonce: OperationNonce
  readonly providerSystemLabel: string
  readonly prompt: string
  readonly sourceUrl?: string
}

export type OffscreenAckMessage = {
  readonly version: typeof MESSAGE_VERSION
  readonly type: "offscreen_ack"
  readonly nonce: OperationNonce
  readonly blobUrl: string
}

export type OffscreenRevokeMessage = {
  readonly version: typeof MESSAGE_VERSION
  readonly type: "offscreen_revoke"
  readonly nonce: OperationNonce
  readonly blobUrl: string
}

export type StatusNotificationMessage =
  | {
      readonly version: typeof MESSAGE_VERSION
      readonly type: "status_notification"
      readonly nonce: OperationNonce
      readonly status: "started"
    }
  | {
      readonly version: typeof MESSAGE_VERSION
      readonly type: "status_notification"
      readonly nonce: OperationNonce
      readonly status: "completed"
    }
  | {
      readonly version: typeof MESSAGE_VERSION
      readonly type: "status_notification"
      readonly nonce: OperationNonce
      readonly status: "failed"
      readonly error: EnrichmentError
    }

export type ExtensionMessage =
  | InitiateOperationMessage
  | OperationAcceptedMessage
  | OperationRejectedMessage
  | MessageRejectedMessage
  | OffscreenJobMessage
  | OffscreenAckMessage
  | OffscreenRevokeMessage
  | StatusNotificationMessage

export type ContentResponse =
  | OperationAcceptedMessage
  | OperationRejectedMessage
  | MessageRejectedMessage

export type MessageParseResult =
  | { readonly kind: "ok"; readonly message: ExtensionMessage }
  | { readonly kind: "rejected"; readonly error: MessageRejection }

export type MessageSender = {
  readonly id?: string
  readonly url?: string
  readonly origin?: string
  readonly tab?: { readonly id?: number }
  readonly frameId?: number
}

export type SenderRejection =
  | { readonly code: "SENDER_RUNTIME_ID_MISMATCH" }
  | { readonly code: "SENDER_URL_MISSING" }
  | { readonly code: "SENDER_ORIGIN_NOT_ALLOWED" }

export type SenderValidationResult =
  | { readonly kind: "ok"; readonly origin: "content" | "offscreen" }
  | { readonly kind: "rejected"; readonly error: SenderRejection }

export type { UnixMilliseconds } from "./contracts"
export { NONCE_PATTERN }
