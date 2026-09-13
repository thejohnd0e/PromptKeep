/**
 * Versioned DOM selectors for grok.com conversation views.
 *
 * Grok renders image cards inside assistant messages; every selector is
 * versioned so fixtures and tests pin the exact DOM shape they cover.
 */
export const GROK_SELECTORS_VERSION = 1

export const GROK_SELECTORS = {
  /** A single conversation message container. */
  message: "[data-testid='conversation-turn'], .message-bubble",
  /** Assistant message container. */
  assistantMessage: "[data-testid='assistant-message'], .message-bubble--assistant",
  /** User message container. */
  userMessage: "[data-testid='user-message'], .message-bubble--user",
  /** Rendered user prompt text. */
  userMessageText: ".message-text",
  /** Generated image card inside an assistant message. */
  generatedImage: "img[src*='grok-assets'], img[data-testid='generated-image']",
  /** Provider-visible download/original control. */
  downloadControl: "a[aria-label*='Download'], button[aria-label*='Download'], a[download]",
  /** Composer for provisional prompt capture. */
  composer: "textarea[placeholder], .composer textarea",
} as const

export type GrokSelectorKey = keyof typeof GROK_SELECTORS
