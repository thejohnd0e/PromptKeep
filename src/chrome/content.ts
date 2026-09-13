import {
  type ImageCandidate,
  type OperationNonce,
  type PromptCapture,
  unixMilliseconds,
} from "../shared/contracts"
import {
  type ContentResponse,
  type ExtensionMessage,
  type InitiateOperationMessage,
  MESSAGE_VERSION,
  operationNonce,
  parseInboundMessage,
} from "../shared/messages"

export function generateOperationNonce(): OperationNonce {
  return operationNonce(crypto.randomUUID())
}

export function createInitiateOperationMessage(
  nonce: OperationNonce,
  promptCapture: PromptCapture,
  imageCandidate: ImageCandidate,
): InitiateOperationMessage {
  return {
    version: MESSAGE_VERSION,
    type: "initiate_operation",
    nonce,
    createdAt: unixMilliseconds(Date.now()),
    promptCapture,
    imageCandidate,
  }
}

function asContentResponse(message: ExtensionMessage): ContentResponse {
  switch (message.type) {
    case "operation_accepted":
    case "operation_rejected":
    case "message_rejected":
      return message
    default:
      return {
        version: MESSAGE_VERSION,
        type: "message_rejected",
        reason: { code: "MESSAGE_UNKNOWN_TYPE" },
      }
  }
}

export async function sendInitiateOperation(
  message: InitiateOperationMessage,
): Promise<ContentResponse> {
  if (chrome.runtime?.id === undefined) {
    throw new Error("extension context invalidated")
  }
  const response: unknown = await chrome.runtime.sendMessage(message)
  const parsed = parseInboundMessage(response, unixMilliseconds(Date.now()))
  if (parsed.kind === "rejected") {
    return { version: MESSAGE_VERSION, type: "message_rejected", reason: parsed.error }
  }
  return asContentResponse(parsed.message)
}

// Minimal listener skeleton. Status UI wiring arrives in task 7; provider
// adapters arrive in tasks 10-12. The content script only sends
// initiate_operation requests and awaits their responses directly.
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  const parsed = parseInboundMessage(message, unixMilliseconds(Date.now()))
  if (parsed.kind === "rejected") return
  switch (parsed.message.type) {
    case "status_notification":
      // Task 7 surfaces these in the injected status UI.
      break
    default:
      // Not a message this content script handles.
      break
  }
})
