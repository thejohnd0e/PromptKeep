export type EagleItem = {
  readonly id: string
  readonly name: string
  readonly filePath: string
  readonly fileURL: string
  annotation: string
  readonly tags: readonly string[]
  readonly ext: string
  save(): Promise<void>
}

export type EagleItemApi = {
  getSelected(): Promise<EagleItem[]>
  onChange(callback: (items: EagleItem[]) => void): void
}

export type EagleApi = {
  item: EagleItemApi
}

export type SelectionState =
  | { readonly kind: "single_png"; readonly filePath: string }
  | { readonly kind: "empty"; readonly reason: string }
  | { readonly kind: "unsupported"; readonly reason: string }

declare global {
  interface Window {
    eagle?: EagleApi
  }
}

export async function getSelectedItems(eagle: EagleApi): Promise<EagleItem[]> {
  return eagle.item.getSelected()
}

export function ensureSinglePngSelection(items: readonly EagleItem[]): SelectionState {
  if (items.length === 0) {
    return { kind: "empty", reason: "No item is selected." }
  }
  if (items.length > 1) {
    return { kind: "unsupported", reason: "Select exactly one item to inspect its metadata." }
  }
  const item = items[0]
  if (item === undefined) {
    return { kind: "empty", reason: "No item is selected." }
  }
  if (item.ext.toLowerCase() !== "png") {
    return { kind: "unsupported", reason: "The selected item is not a PNG image." }
  }
  return { kind: "single_png", filePath: item.filePath }
}

export function getFilePath(item: EagleItem): string {
  return item.filePath
}

export function annotationGetter(item: EagleItem): string {
  return item.annotation
}

export function setAnnotation(item: EagleItem, text: string): void {
  item.annotation = text
}

export function saveItem(item: EagleItem): Promise<void> {
  return item.save()
}
