/**
 * Versioned DOM selectors for chatgpt.com conversation views.
 *
 * ChatGPT ships selector-breaking changes frequently; every selector here is
 * versioned so fixtures and tests pin the exact DOM shape they cover. When a
 * selector stops matching, bump the version and refresh the fixtures.
 */
export const CHATGPT_SELECTORS_VERSION = 3

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
    "img[src*='/backend-api/estuary/content'], [data-testid*='image'] img[src], [class*='imagegen-image'] img[src]",
  /** Provider-visible download control for a generated image. */
  downloadControl: "a[aria-label*='Download'], button[aria-label*='Download']",
  /** Composer textarea for provisional prompt capture. */
  composer: "#prompt-textarea",
  editMessage: "button[aria-label='Edit message']",
  editComposer:
    "[contenteditable='true'][role='textbox'][aria-label='Edit message'], textarea[aria-label='Edit message']",
  sendMessage: "button[aria-label='Send']",
  currentGallery: "[data-testid='generated-image-gallery']",
  currentAssistantHeading: "h4[data-conversation-role='assistant']",
  currentUserUnit: "[data-chatgpt-search-unit-key$=':user']",
  currentUserText: "[data-search-result-target]",
} as const

export type ChatGptSelectorKey = keyof typeof CHATGPT_SELECTORS
