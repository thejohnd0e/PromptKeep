import type { EagleItem } from "./eagle-api"

export type AnnotationActionResult =
  | { readonly kind: "success"; readonly saved: boolean }
  | { readonly kind: "error"; readonly reason: string }

const ANNOTATION_HEADER = "AI Prompt:"

/**
 * Idempotently appends the AI prompt block to the item annotation.
 *
 * The block is exactly `AI Prompt:\n<prompt>` appended after one blank line.
 * If the exact block already exists, the annotation is left untouched and no
 * save is performed. Otherwise the existing annotation is preserved and the
 * block is appended; `item.save()` is called exactly once.
 */
export async function appendPromptAnnotation(
  item: EagleItem,
  prompt: string,
): Promise<AnnotationActionResult> {
  const block = `${ANNOTATION_HEADER}\n${prompt}`
  const existing = item.annotation
  if (annotationContainsBlock(existing, block)) {
    return { kind: "success", saved: false }
  }
  const separator = existing.trim() === "" ? "" : "\n\n"
  const updated = `${existing}${separator}${block}`
  item.annotation = updated
  try {
    await item.save()
    return { kind: "success", saved: true }
  } catch {
    item.annotation = existing
    return {
      kind: "error",
      reason: "Saving the annotation failed. The annotation was not changed.",
    }
  }
}

function annotationContainsBlock(annotation: string, block: string): boolean {
  if (annotation === "") return false
  const parts = annotation.split("\n\n")
  return parts.includes(block)
}
