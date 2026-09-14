import { expect, it } from "vitest"
import { buildExifProfile } from "../../../src/metadata/exif-profile"

it("uses word-aligned offsets for every external TIFF value", () => {
  const profile = buildExifProfile({ description: "abcd", software: "ChatGPT" })
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength)
  const ifd0Offset = view.getUint32(4, true)
  const descriptionEntry = ifd0Offset + 2
  const softwareEntry = descriptionEntry + 12
  const exifPointerEntry = softwareEntry + 12
  const xpCommentEntry = exifPointerEntry + 12

  const descriptionOffset = view.getUint32(descriptionEntry + 8, true)
  const softwareOffset = view.getUint32(softwareEntry + 8, true)
  const exifIfdOffset = view.getUint32(exifPointerEntry + 8, true)
  const xpCommentOffset = view.getUint32(xpCommentEntry + 8, true)
  const userCommentOffset = view.getUint32(exifIfdOffset + 10, true)

  expect([
    descriptionOffset,
    softwareOffset,
    exifIfdOffset,
    xpCommentOffset,
    userCommentOffset,
  ]).toSatisfy((offsets: number[]) => offsets.every((offset) => offset % 2 === 0))
})
