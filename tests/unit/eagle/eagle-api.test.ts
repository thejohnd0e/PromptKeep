import { describe, expect, it, vi } from "vitest"
import {
  annotationGetter,
  type EagleApi,
  type EagleItem,
  ensureSinglePngSelection,
  getFilePath,
  getSelectedItems,
  saveItem,
  setAnnotation,
} from "../../../eagle-plugin/src/eagle-api"
import {
  createInspector,
  type RenderState,
  resolveSelection,
} from "../../../eagle-plugin/src/plugin"

function makeFakeItem(overrides: Partial<EagleItem> = {}): EagleItem {
  return {
    id: "item-1",
    name: "image.png",
    filePath: "/library/images/image.png",
    fileURL: "file:///library/images/image.png",
    annotation: "",
    tags: [],
    ext: "png",
    save: vi.fn(async () => undefined),
    ...overrides,
  }
}

function makeFakeEagle(selected: readonly EagleItem[] = []): {
  eagle: EagleApi
  setSelected: (items: readonly EagleItem[]) => void
} {
  let current = [...selected]
  let changeHandler: ((items: EagleItem[]) => void) | undefined
  const eagle: EagleApi = {
    item: {
      getSelected: vi.fn(async () => current),
      onChange: (callback) => {
        changeHandler = callback
      },
    },
  }
  return {
    eagle,
    setSelected: (items: readonly EagleItem[]) => {
      current = [...items]
      changeHandler?.([...items])
    },
  }
}

describe("eagle inspector selection lifecycle", () => {
  it("surfaces the exact filePath when exactly one PNG is selected", async () => {
    const item = makeFakeItem({ filePath: "/library/images/photo.png" })
    const { eagle } = makeFakeEagle([item])

    const state = await resolveSelection(eagle)

    expect(state).toEqual({ kind: "single_png", filePath: "/library/images/photo.png" })
    expect(item.save).not.toHaveBeenCalled()
  })

  it("reports an empty state when nothing is selected", async () => {
    const { eagle } = makeFakeEagle([])

    const state = await resolveSelection(eagle)

    expect(state.kind).toBe("empty")
    if (state.kind === "empty") {
      expect(state.reason.length).toBeGreaterThan(0)
    }
  })

  it("reports an unsupported state when two items are selected", async () => {
    const first = makeFakeItem({ id: "item-1" })
    const second = makeFakeItem({ id: "item-2" })
    const { eagle } = makeFakeEagle([first, second])

    const state = await resolveSelection(eagle)

    expect(state.kind).toBe("unsupported")
    expect(first.save).not.toHaveBeenCalled()
    expect(second.save).not.toHaveBeenCalled()
  })

  it("reports an unsupported state when a non-PNG item is selected", async () => {
    const item = makeFakeItem({ ext: "jpg", filePath: "/library/images/photo.jpg" })
    const { eagle } = makeFakeEagle([item])

    const state = await resolveSelection(eagle)

    expect(state.kind).toBe("unsupported")
    expect(item.save).not.toHaveBeenCalled()
  })

  it("never calls save() across the selection lifecycle", async () => {
    const item = makeFakeItem()
    const { eagle, setSelected } = makeFakeEagle([])
    const rendered: RenderState[] = []
    createInspector(eagle, (state) => {
      rendered.push(state)
    })

    setSelected([item])
    await vi.waitFor(() => {
      expect(rendered).toHaveLength(2)
    })

    expect(rendered[0]).toEqual({ kind: "empty", reason: expect.any(String) })
    expect(rendered[1]).toEqual({ kind: "single_png", filePath: "/library/images/image.png" })
    expect(item.save).not.toHaveBeenCalled()
  })

  it("reads only filePath, never fileURL", () => {
    const item = makeFakeItem({ filePath: "/real/path.png", fileURL: "file:///fake/path.png" })

    expect(getFilePath(item)).toBe("/real/path.png")
  })

  it("exposes annotation and save wrappers without auto-writing", async () => {
    const item = makeFakeItem({ annotation: "existing note" })

    expect(annotationGetter(item)).toBe("existing note")
    setAnnotation(item, "new note")
    expect(item.annotation).toBe("new note")
    await saveItem(item)
    expect(item.save).toHaveBeenCalledTimes(1)
  })

  it("getSelectedItems reads eagle.item.getSelected", async () => {
    const item = makeFakeItem()
    const { eagle } = makeFakeEagle([item])

    const items = await getSelectedItems(eagle)

    expect(items).toEqual([item])
  })

  it("ensureSinglePngSelection rejects zero, multiple, and non-PNG selections", () => {
    const png = makeFakeItem()
    const jpg = makeFakeItem({ ext: "jpg" })

    expect(ensureSinglePngSelection([]).kind).toBe("empty")
    expect(ensureSinglePngSelection([png, jpg]).kind).toBe("unsupported")
    expect(ensureSinglePngSelection([jpg]).kind).toBe("unsupported")
    expect(ensureSinglePngSelection([png])).toEqual({
      kind: "single_png",
      filePath: "/library/images/image.png",
    })
  })
})
