import { createAssetTransferStore } from "../shared/asset-transfer"
import { unixMilliseconds } from "../shared/contracts"
import {
  MESSAGE_VERSION,
  type MessageRejectedMessage,
  type MessageRejection,
  parseInboundMessage,
} from "../shared/messages"
import { revokePngBlobUrl, runPngTask } from "./png-task"

const assetTransfer = createAssetTransferStore(caches)

function messageRejectedResponse(reason: MessageRejection): MessageRejectedMessage {
  return { version: MESSAGE_VERSION, type: "message_rejected", reason }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.tab !== undefined) return
  if (sender.id !== chrome.runtime.id) {
    sendResponse(messageRejectedResponse({ code: "SENDER_RUNTIME_ID_MISMATCH" }))
    return
  }
  const parseResult = parseInboundMessage(message, unixMilliseconds(Date.now()))
  if (parseResult.kind === "rejected") {
    sendResponse(messageRejectedResponse(parseResult.error))
    return
  }
  switch (parseResult.message.type) {
    case "offscreen_job": {
      const job = parseResult.message
      void runPngTask(
        {
          nonce: job.nonce,
          providerSystemLabel: job.providerSystemLabel,
          prompt: job.prompt,
          ...(job.sourceUrl === undefined ? {} : { sourceUrl: job.sourceUrl }),
        },
        { loadAsset: assetTransfer.take },
      ).then((result) => {
        sendResponse(result.message)
      })
      return true
    }
    case "offscreen_revoke": {
      revokePngBlobUrl(parseResult.message.blobUrl)
      return
    }
    default:
      sendResponse(messageRejectedResponse({ code: "MESSAGE_UNKNOWN_TYPE" }))
      return
  }
})
