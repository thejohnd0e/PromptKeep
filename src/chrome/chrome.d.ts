declare global {
  namespace chrome {
    namespace runtime {
      const id: string

      interface MessageSender {
        id?: string
        url?: string
        origin?: string
        tab?: { id?: number }
        frameId?: number
      }

      type SendResponse = (response?: unknown) => void

      type MessageListener = (
        message: unknown,
        sender: MessageSender,
        sendResponse: SendResponse,
      ) => boolean | undefined

      interface OnMessageEvent {
        addListener(listener: MessageListener): void
      }

      const onMessage: OnMessageEvent

      function sendMessage(message: unknown): Promise<unknown>

      function getURL(path: string): string

      function getManifest(): { readonly version: string }

      type RuntimeContextType =
        | "TAB"
        | "OFFSCREEN_DOCUMENT"
        | "POPUP"
        | "SIDE_PANEL"
        | "DEVELOPER_TOOLS"
        | "BACKGROUND"
        | "ALL"

      interface RuntimeContext {
        contextType: RuntimeContextType
        documentUrl?: string
        documentId?: string
        frameId?: number
        tabId?: number
      }

      interface RuntimeContextFilter {
        contextTypes?: RuntimeContextType[]
        documentUrls?: string[]
        documentIds?: string[]
        frameIds?: number[]
        tabIds?: number[]
      }

      function getContexts(filter: RuntimeContextFilter): Promise<RuntimeContext[]>
    }

    namespace offscreen {
      type OffscreenReason =
        | "TESTING"
        | "BLOBS"
        | "DOM_PARSER"
        | "AUDIO_PLAYBACK"
        | "IFRAME_SCRIPTING"
        | "USER_MEDIA"
        | "DISPLAY_MEDIA"
        | "WEB_RTC"
        | "CLIPBOARD"
        | "LOCAL_STORAGE"
        | "WORKERS"
        | "BATTERY_STATUS"
        | "MATCH_MEDIA"
        | "GEOLOCATION"

      interface CreateDocumentOptions {
        url: string
        reasons: OffscreenReason[]
        justification: string
      }

      function createDocument(options: CreateDocumentOptions): Promise<void>
    }

    namespace downloads {
      type DownloadConflictAction = "uniquify" | "overwrite" | "prompt"

      interface DownloadOptions {
        url: string
        filename?: string
        conflictAction?: DownloadConflictAction
        saveAs?: boolean
      }

      type DownloadState = "in_progress" | "interrupted" | "complete"

      interface DownloadDelta {
        id: number
        state?: { current?: DownloadState }
        error?: { current?: string }
      }

      interface OnChangedEvent {
        addListener(listener: (delta: DownloadDelta) => void): void
        removeListener(listener: (delta: DownloadDelta) => void): void
      }

      const onChanged: OnChangedEvent

      function download(options: DownloadOptions): Promise<number>
    }

    namespace storage {
      interface StorageArea {
        get(
          keys?: string | string[] | Record<string, unknown> | null,
        ): Promise<Record<string, unknown>>
        set(items: Record<string, unknown>): Promise<void>
        remove(keys: string | string[]): Promise<void>
      }

      const local: StorageArea
    }
  }
}

export {}
