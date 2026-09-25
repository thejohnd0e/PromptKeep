import type { Provider } from "../shared/contracts"
import { scanChatGptTurns } from "./chatgpt/adapter"
import { readChatGptImageBytes } from "./chatgpt/download"
import { scanGeminiTurns } from "./gemini/adapter"
import { readGeminiImageBytes } from "./gemini/download"
import { scanGrokImagine } from "./grok/adapter"
import { readGrokImageBytes } from "./grok/download"
import type { ProviderAdapter } from "./types"

export const providerAdapters: Readonly<Record<Provider, ProviderAdapter>> = {
  chatgpt: { scan: scanChatGptTurns, readImageBytes: readChatGptImageBytes },
  gemini: { scan: scanGeminiTurns, readImageBytes: readGeminiImageBytes },
  grok: { scan: scanGrokImagine, readImageBytes: readGrokImageBytes },
}
