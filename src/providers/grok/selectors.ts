/**
 * Versioned selectors for the Grok Imagine post view.
 *
 * The home page contains unrelated template images, so only images rendered
 * inside the post article are eligible for prompt metadata.
 */
export const GROK_SELECTORS_VERSION = 2

export const GROK_SELECTORS = {
  postArticle: "main article",
  image: "img",
  composer: "[aria-label='Ask Grok anything']",
} as const

export type GrokSelectorKey = keyof typeof GROK_SELECTORS
