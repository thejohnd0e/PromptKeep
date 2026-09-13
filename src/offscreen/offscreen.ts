import { unixMilliseconds } from "../shared/contracts"
import {
  MESSAGE_VERSION,
  type MessageRejectedMessage,
  type MessageRejection,
  type OffscreenAckMessage,
  parseInboundMessage,
} from "../shared/messages"

function messageRejectedResponse(reason: MessageRejection): MessageRejectedMessage {
  return { version: MESSAGE_VERSION, type: "message_rejected", reason }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    sendResponse(messageRejectedResponse({ code: "SENDER_RUNTIME_ID_MISMATCH" }))
    return
  }
  const parseResult = parseInboundMessage(message, unixMilliseconds(Date.now()))
  if (parseResult.kind === "rejected") {
    sendResponse(messageRejectedResponse(parseResult.error))
    return
  }
  if (parseResult.message.type !== "offscreen_job") {
    sendResponse(messageRejectedResponse({ code: "MESSAGE_UNKNOWN_TYPE" }))
    return
  }
  const job = parseResult.message
  // Task 8 transforms job.pngBytes here. For now, echo a typed acknowledgement.
  const ack: OffscreenAckMessage = {
    version: MESSAGE_VERSION,
    type: "offscreen_ack",
    nonce: job.nonce,
  }
  sendResponse(ack)
})
