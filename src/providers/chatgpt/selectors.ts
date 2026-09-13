/**
 * Versioned DOM selectors for chatgpt.com conversation views.
 *
 * ChatGPT ships selector-breaking changes frequently; every selector here is
 * versioned so fixtures and tests pin the exact DOM shape they cover. When a
 * selector stops matching, bump the version and refresh the fixtures.
 */
export const CHATGPT_SELECTORS_VERSION = 1

export const CHATGPT_SELECTORS = {
  /** The message thread container holding all turns. */
  thread: "[data-testid^='conversation-turn']",
  /** A single conversation turn (user or assistant). */
  turn: "[data-testid^='conversation-turn']",
  /** The user's rendered prompt text inside a user turn. */
  userTurnText: ".whitespace-pre-wrap",
  /** Assistant turn container (data-message-author-role="assistant"). */
  assistantTurn: "[data-message-author-role='assistant']",
  /** User turn container (data-message-author-role="user"). */
  userTurn: "[data-message-author-role='user']",
  /** Generated image inside an assistant turn. */
  generatedImage:
    "img[alt^='Uploaded image'], img[src*='oaiusercontent.com'], img[src*='azureedge.net']",
  /** Provider-visible download control for a generated image. */
  downloadControl: "a[aria-label*='Download'], button[aria-label*='Download']",
  /** Composer textarea for provisional prompt capture. */
  composer: "#prompt-textarea",
} as const

export type ChatGptSelectorKey = keyof typeof CHATGPT_SELECTORS
