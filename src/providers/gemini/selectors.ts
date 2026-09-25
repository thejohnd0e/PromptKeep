/**
 * Versioned DOM selectors for gemini.google.com conversation views.
 *
 * Gemini renders model turns with generated-image containers; every selector
 * is versioned so fixtures and tests pin the exact DOM shape they cover.
 */
export const GEMINI_SELECTORS_VERSION = 3

export const GEMINI_SELECTORS = {
  /** A single conversation turn container. */
  turn: "model-response, user-query",
  /** Model (assistant) turn container. */
  modelTurn: "model-response",
  /** User turn container. */
  userTurn: "user-query",
  userTurnText: ".query-text-line",
  userTurnTextFallback: ".query-text",
  /** Generated image inside a model turn. */
  generatedImage: "img.generated-image, img[src*='lh3.googleusercontent.com'], img[src^='blob:']",
  /** Provider-visible full-size download control. */
  downloadControl: "a[aria-label*='Download'], button[aria-label*='Download'], a[download]",
  regenerateTrigger: "gem-icon-button[data-test-id='regenerate-button']",
  regenerateOption: "gem-menu-item[data-test-id='regenerate-option']",
  /** Composer for provisional prompt capture. */
  composer: ".ql-editor[contenteditable='true'], rich-textarea .ql-editor",
  modeButton: "button[data-test-id='bard-mode-menu-button']",
  selectedMode: "[data-test-id='gem-mode-menu'] gem-menu-item.selected .label",
  /** Images/Library unsupported state marker. */
  unsupportedState: "[data-test-id='unsupported-state'], .unsupported-state",
} as const

export type GeminiSelectorKey = keyof typeof GEMINI_SELECTORS
