import {
  type EnrichmentError,
  LIMITS,
  type OperationNonce,
  type Provider,
  unixMilliseconds,
} from "../shared/contracts"
import {
  type InitiateOperationMessage,
  MESSAGE_VERSION,
  type MessageRejectedMessage,
  type MessageRejection,
  OFFSCREEN_DOCUMENT_PATH,
  type OffscreenJobMessage,
  type OperationAcceptedMessage,
  type OperationRejectedMessage,
  parseInboundMessage,
  validateMessageSender,
} from "../shared/messages"
import { NonceRegistry } from "../shared/nonce-registry"

class UnreachableProviderError extends Error {
  readonly name = "UnreachableProviderError"
}

function assertNever(value: never): never {
  throw new UnreachableProviderError(`unexpected provider: ${String(value)}`)
}

function providerSystemLabel(provider: Provider): string {
  switch (provider) {
    case "chatgpt":
      return "ChatGPT"
    case "gemini":
      return "Google Gemini"
    case "grok":
      return "Grok"
    default:
      return assertNever(provider)
  }
}

// Ephemeral replay guard only; no required operation state lives in globals so
// the service worker stays suspend-safe. Production persistence is task 8.
const nonceRegistry = new NonceRegistry(() => unixMilliseconds(Date.now()))

async function ensureOffscreenDocument(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })
  if (contexts.length > 0) return
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["BLOBS"],
    justification: "Transform PNG bytes into a Blob for the downloads API.",
  })
}

function acceptedResponse(nonce: OperationNonce): OperationAcceptedMessage {
  return { version: MESSAGE_VERSION, type: "operation_accepted", nonce }
}

function rejectedResponse(nonce: OperationNonce, error: EnrichmentError): OperationRejectedMessage {
  return { version: MESSAGE_VERSION, type: "operation_rejected", nonce, error }
}

function messageRejectedResponse(reason: MessageRejection): MessageRejectedMessage {
  return { version: MESSAGE_VERSION, type: "message_rejected", reason }
}

async function handleInitiateOperation(
  message: InitiateOperationMessage,
): Promise<OperationAcceptedMessage | OperationRejectedMessage> {
  const expiresAt = unixMilliseconds(message.createdAt + LIMITS.operationExpiryMilliseconds)
  const registered = nonceRegistry.register(message.nonce, expiresAt)
  if (registered.kind === "rejected") {
    return rejectedResponse(message.nonce, { code: "operation_cancelled" })
  }
  await ensureOffscreenDocument()
  const job: OffscreenJobMessage = {
    version: MESSAGE_VERSION,
    type: "offscreen_job",
    nonce: message.nonce,
    providerSystemLabel: providerSystemLabel(message.promptCapture.provider),
    prompt: message.promptCapture.originalPrompt,
    // Placeholder bytes: secure asset retrieval and real PNG mutation are task 8.
    pngBytes: new ArrayBuffer(0),
  }
  const ack: unknown = await chrome.runtime.sendMessage(job)
  const parsedAck = parseInboundMessage(ack, unixMilliseconds(Date.now()))
  if (parsedAck.kind === "rejected" || parsedAck.message.type !== "offscreen_ack") {
    return rejectedResponse(message.nonce, { code: "operation_cancelled" })
  }
  nonceRegistry.consume(message.nonce)
  return acceptedResponse(message.nonce)
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const senderResult = validateMessageSender(sender, chrome.runtime.id)
  if (senderResult.kind === "rejected") {
    sendResponse(messageRejectedResponse(senderResult.error))
    return
  }
  const parseResult = parseInboundMessage(message, unixMilliseconds(Date.now()))
  if (parseResult.kind === "rejected") {
    sendResponse(messageRejectedResponse(parseResult.error))
    return
  }
  switch (parseResult.message.type) {
    case "initiate_operation": {
      const initiate = parseResult.message
      void handleInitiateOperation(initiate).then(sendResponse, () => {
        sendResponse(rejectedResponse(initiate.nonce, { code: "operation_cancelled" }))
      })
      return true
    }
    default:
      sendResponse(messageRejectedResponse({ code: "MESSAGE_UNKNOWN_TYPE" }))
      return
  }
})
