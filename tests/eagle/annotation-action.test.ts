import { describe, expect, it } from "vitest"
import { appendPromptAnnotation } from "../../eagle-plugin/src/annotation-action"
import type { EagleItem } from "../../eagle-plugin/src/eagle-api"

function makeItem(
  annotation: string,
  saveImpl?: () => Promise<void>,
): EagleItem & { saveCalls: number } {
  const item = {
    id: "item-1",
    name: "image.png",
    filePath: "C:/lib/image.png",
    fileURL: "file:///C:/lib/image.png",
    annotation,
    tags: [],
    ext: "png",
    saveCalls: 0,
    save(): Promise<void> {
      item.saveCalls += 1
      if (saveImpl) return saveImpl()
      return Promise.resolve()
    },
  }
  return item
}

describe("appendPromptAnnotation", () => {
  it("appends the block to an empty annotation and saves once", async () => {
    const item = makeItem("")
    const result = await appendPromptAnnotation(item, "a cat in space")
    expect(result).toEqual({ kind: "success", saved: true })
    expect(item.annotation).toBe("AI Prompt:\na cat in space")
    expect(item.saveCalls).toBe(1)
  })

  it("preserves existing annotation and appends after one blank line", async () => {
    const item = makeItem("Notes\nabout the image")
    await appendPromptAnnotation(item, "prompt text")
    expect(item.annotation).toBe("Notes\nabout the image\n\nAI Prompt:\nprompt text")
    expect(item.saveCalls).toBe(1)
  })

  it("is idempotent: exact existing block means no save", async () => {
    const existing = "Notes\n\nAI Prompt:\nprompt text"
    const item = makeItem(existing)
    const result = await appendPromptAnnotation(item, "prompt text")
    expect(result).toEqual({ kind: "success", saved: false })
    expect(item.annotation).toBe(existing)
    expect(item.saveCalls).toBe(0)
  })

  it("does not dedupe a partial or different block", async () => {
    const item = makeItem("AI Prompt:\nanother prompt")
    await appendPromptAnnotation(item, "prompt text")
    expect(item.annotation).toBe("AI Prompt:\nanother prompt\n\nAI Prompt:\nprompt text")
    expect(item.saveCalls).toBe(1)
  })

  it("restores prior annotation and reports error when save rejects", async () => {
    const item = makeItem("Notes", () => Promise.reject(new Error("disk full")))
    const result = await appendPromptAnnotation(item, "p")
    expect(result).toEqual({
      kind: "error",
      reason: "Saving the annotation failed. The annotation was not changed.",
    })
    expect(item.annotation).toBe("Notes")
    expect(item.saveCalls).toBe(1)
  })

  it("handles long Unicode prompts exactly", async () => {
    const prompt = "кот 🐈 ".repeat(500)
    const item = makeItem("")
    await appendPromptAnnotation(item, prompt)
    expect(item.annotation.endsWith(`AI Prompt:\n${prompt}`)).toBe(true)
  })
})
