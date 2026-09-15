;(() => {
  if (location.hostname !== "gemini.google.com") return
  const script = document.currentScript
  const eventId = script?.dataset?.aip2eEventId
  if (eventId === undefined) return

  const originalCreateObjectUrl = window.URL.createObjectURL
  const originalAnchorClick = window.HTMLAnchorElement.prototype.click
  const originalPostMessage = window.MessagePort.prototype.postMessage
  const blobs = new Map()
  let restored = false
  let captured = false
  const emitBlob = (blob, replyPort) => {
    if (captured) return
    captured = true
    blob
      .arrayBuffer()
      .then((buffer) => {
        if (replyPort) originalPostMessage.call(replyPort, { result: undefined })
        window.dispatchEvent(new CustomEvent(eventId, { detail: [...new Uint8Array(buffer)] }))
      })
      .catch(() => {
        if (replyPort) originalPostMessage.call(replyPort, { error: "Image capture failed" })
        window.dispatchEvent(new CustomEvent(eventId, { detail: null }))
      })
      .finally(restore)
  }
  const restore = () => {
    if (restored) return
    restored = true
    clearTimeout(timeoutId)
    blobs.clear()
    window.URL.createObjectURL = originalCreateObjectUrl
    window.HTMLAnchorElement.prototype.click = originalAnchorClick
    window.MessagePort.prototype.postMessage = originalPostMessage
  }

  window.HTMLAnchorElement.prototype.click = function click() {
    const blob = blobs.get(this.href)
    if (blob && this.download.startsWith("Gemini_Generated_Image_")) {
      emitBlob(blob)
      return
    }
    originalAnchorClick.call(this)
  }

  // Gemini's SafeDownloader sends the full-size Blob to an isolated sandbox.
  window.MessagePort.prototype.postMessage = function postMessage(...args) {
    const [message, transfer] = args
    const names = message?.paramNames
    const values = message?.values
    if (Array.isArray(names) && Array.isArray(values) && typeof message.code === "string") {
      const blob = values[names.indexOf("blob")]
      const filename = values[names.indexOf("filename")]
      const replyPort = (Array.isArray(transfer) ? transfer : transfer?.transfer)?.[0]
      if (
        blob instanceof Blob &&
        typeof filename === "string" &&
        filename.startsWith("Gemini_Generated_Image_") &&
        message.code.includes("URL.createObjectURL") &&
        message.code.includes(".download=") &&
        replyPort instanceof MessagePort
      ) {
        emitBlob(blob, replyPort)
        return
      }
    }
    return originalPostMessage.apply(this, args)
  }
  window.URL.createObjectURL = (object) => {
    const url = originalCreateObjectUrl.call(window.URL, object)
    if (object instanceof Blob) blobs.set(url, object)
    return url
  }
  const timeoutId = window.setTimeout(restore, 30_000)
})()
