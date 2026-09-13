import { createDownloader, type DownloadOutcome } from "../chrome/download-coordinator"
import { unixMilliseconds } from "../shared/contracts"
import {
  MESSAGE_VERSION,
  type MessageRejectedMessage,
  type MessageRejection,
  parseInboundMessage,
} from "../shared/messages"
import { runPngTask } from "./png-task"

function messageRejectedResponse(reason: MessageRejection): MessageRejectedMessage {
  return { version: MESSAGE_VERSION, type: "message_rejected", reason }
}

function waitForDownloadCompletion(downloadId: number): Promise<DownloadOutcome> {
  return new Promise((resolve) => {
    const listener = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== downloadId) return
      if (delta.state?.current === "complete") {
        chrome.downloads.onChanged.removeListener(listener)
        resolve({ kind: "completed" })
      } else if (delta.state?.current === "interrupted") {
        chrome.downloads.onChanged.removeListener(listener)
        const error = delta.error?.current
        resolve(error === undefined ? { kind: "interrupted" } : { kind: "interrupted", error })
      }
    }
    chrome.downloads.onChanged.addListener(listener)
  })
}

const downloader = createDownloader({
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  download: (options) => chrome.downloads.download(options),
  waitForDownload: waitForDownloadCompletion,
})

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
  void runPngTask(
    {
      nonce: job.nonce,
      providerSystemLabel: job.providerSystemLabel,
      prompt: job.prompt,
      pngBytes: job.pngBytes,
      filenameBase: job.nonce,
      acknowledgeCaBX: false,
    },
    { downloadBytes: downloader },
  ).then((result) => {
    sendResponse(result.message)
  })
  return true
})
