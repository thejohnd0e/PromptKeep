import { adapterFor, startController } from "../content/controller"
import {
  type ImageCandidate,
  type OperationNonce,
  type PromptCapture,
  type Provider,
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

function providerForHost(hostname: string): Provider | undefined {
  if (hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com")) return "chatgpt"
  if (hostname === "gemini.google.com" || hostname.endsWith(".gemini.google.com")) return "gemini"
  if (hostname === "grok.com" || hostname.endsWith(".grok.com")) return "grok"
  return undefined
}

// Provider controller wiring: scan the provider DOM, mount download controls,
// and send initiate_operation on confirmed downloads. Guarded so the module
// stays importable in non-extension test environments.
if (typeof chrome !== "undefined" && chrome.runtime?.id !== undefined) {
  const provider = providerForHost(location.hostname)
  if (provider !== undefined) {
    startController({
      document_like: document,
      provider,
      scan: adapterFor(provider),
      sendInitiate: sendInitiateOperation,
      now: () => unixMilliseconds(Date.now()),
      pageUrl: () => location.href,
    })
  }
}
