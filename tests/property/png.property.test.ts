import fc from "fast-check"
import { expect, it } from "vitest"
import { parsePng } from "../../src/metadata/png-parser"
import { insertXmpItxt } from "../../src/metadata/png-writer"
import {
  buildPng,
  makeChunk,
  makeIdat,
  makeIend,
  makeIhdr,
  makeXmpItxt,
} from "../fixtures/png/png-fixtures"

const XMP = new TextEncoder().encode("<x:xmpmeta/>")

type PngModel = {
  readonly width: number
  readonly height: number
  readonly ancillary: readonly { readonly type: string; readonly payload: Uint8Array }[]
  readonly hasXmp: boolean
  readonly idatCount: number
}

const pngModelArbitrary: fc.Arbitrary<PngModel> = fc.record({
  width: fc.integer({ min: 1, max: 100 }),
  height: fc.integer({ min: 1, max: 100 }),
  ancillary: fc.array(
    fc.record({
      type: fc.constantFrom("tEXt", "caBX", "prVt"),
      payload: fc.uint8Array({ minLength: 0, maxLength: 32 }),
    }),
    { maxLength: 5 },
  ),
  hasXmp: fc.boolean(),
  idatCount: fc.integer({ min: 1, max: 3 }),
})

function buildPngFromModel(model: PngModel): Uint8Array {
  const chunks: Uint8Array[] = [makeIhdr(model.width, model.height)]
  for (const ancillary of model.ancillary) {
    chunks.push(makeChunk(ancillary.type, ancillary.payload))
  }
  if (model.hasXmp) {
    chunks.push(makeXmpItxt(new TextEncoder().encode("<x:xmpmeta>old</x:xmpmeta>")))
  }
  for (let i = 0; i < model.idatCount; i++) {
    chunks.push(makeIdat())
  }
  chunks.push(makeIend())
  return buildPng(chunks)
}

function nonXmpChunks(
  png: Uint8Array,
): readonly { readonly type: string; readonly data: Uint8Array; readonly crc: number }[] {
  const parsed = parsePng(png)
  if (parsed.kind !== "ok") return []
  return parsed.value.chunks
    .filter((chunk) => chunk.type !== "iTXt" || chunk.index !== parsed.value.xmpChunkIndex)
    .map((chunk) => ({
      type: chunk.type,
      data: png.subarray(chunk.dataOffset, chunk.crcOffset),
      crc: chunk.crc,
    }))
}

it("preserves every non-XMP chunk byte-for-byte and inserts exactly one XMP packet before the first IDAT", () => {
  fc.assert(
    fc.property(pngModelArbitrary, (model) => {
      const input = buildPngFromModel(model)
      const result = insertXmpItxt(input, XMP)

      expect(result.kind).toBe("ok")
      if (result.kind !== "ok") return
      const output = result.value

      const parsed = parsePng(output)
      expect(parsed.kind).toBe("ok")
      if (parsed.kind !== "ok") return
      const xmpIndex = parsed.value.xmpChunkIndex
      expect(xmpIndex).toBeDefined()
      const firstIdatIndex = parsed.value.chunks.findIndex((chunk) => chunk.type === "IDAT")
      expect(xmpIndex).toBeLessThan(firstIdatIndex)
      expect(parsed.value.xmp?.data).toEqual(XMP)

      expect(nonXmpChunks(output)).toEqual(nonXmpChunks(input))
    }),
  )
})

it("rejects with PNG_CRC_MISMATCH when any chunk CRC byte is flipped", () => {
  fc.assert(
    fc.property(
      pngModelArbitrary,
      fc.nat({ max: 20 }),
      fc.nat({ max: 3 }),
      (model, chunkOffset, crcByte) => {
        const input = buildPngFromModel(model)
        const parsed = parsePng(input)
        expect(parsed.kind).toBe("ok")
        if (parsed.kind !== "ok") return
        const chunk = parsed.value.chunks[chunkOffset % parsed.value.chunks.length]
        if (chunk === undefined) return
        const corrupted = input.slice()
        corrupted[chunk.crcOffset + crcByte] = (corrupted[chunk.crcOffset + crcByte] ?? 0) ^ 0xff

        const result = parsePng(corrupted)

        expect(result.kind).toBe("rejected")
        if (result.kind !== "rejected") return
        expect(result.error.code).toBe("PNG_CRC_MISMATCH")
      },
    ),
  )
})

it("reports the same dimensions for any valid PNG", () => {
  fc.assert(
    fc.property(pngModelArbitrary, (model) => {
      const input = buildPngFromModel(model)
      const result = parsePng(input)

      expect(result.kind).toBe("ok")
      if (result.kind !== "ok") return
      expect(result.value.width).toBe(model.width)
      expect(result.value.height).toBe(model.height)
    }),
  )
})
