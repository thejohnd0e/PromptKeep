const TIFF_HEADER_BYTES = 8
const IFD_ENTRY_BYTES = 12
const IFD_TRAILER_BYTES = 4

const TIFF_TYPE = {
  byte: 1,
  ascii: 2,
  long: 4,
  undefined: 7,
} as const

const EXIF_TAG = {
  imageDescription: 0x010e,
  software: 0x0131,
  exifIfdPointer: 0x8769,
  userComment: 0x9286,
  xpComment: 0x9c9c,
} as const

const USER_COMMENT_UNICODE_PREFIX = new Uint8Array([0x55, 0x4e, 0x49, 0x43, 0x4f, 0x44, 0x45, 0x00])

export type ExifProfileInput = {
  readonly description: string
  readonly software: string
}

type IfdValue = {
  readonly tag: number
  readonly type: number
  readonly bytes: Uint8Array
}

function asciiBytes(value: string): Uint8Array {
  let ascii = ""
  for (const character of value) {
    ascii += character.charCodeAt(0) <= 0x7f ? character : "?"
  }
  return new TextEncoder().encode(`${ascii}\0`)
}

function utf16LeBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length * 2 + 2)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < value.length; index += 1) {
    view.setUint16(index * 2, value.charCodeAt(index), true)
  }
  return bytes
}

function alignedOffset(offset: number): number {
  return offset + (offset % 2)
}

function externalDataEnd(startOffset: number, values: readonly IfdValue[]): number {
  return values.reduce((offset, value) => {
    if (value.bytes.byteLength <= 4) return offset
    return alignedOffset(offset) + value.bytes.byteLength
  }, startOffset)
}

function writeValueEntry(
  output: Uint8Array,
  entryOffset: number,
  value: IfdValue,
  dataOffset: number,
): number {
  const view = new DataView(output.buffer)
  view.setUint16(entryOffset, value.tag, true)
  view.setUint16(entryOffset + 2, value.type, true)
  view.setUint32(entryOffset + 4, value.bytes.byteLength, true)
  if (value.bytes.byteLength <= 4) {
    output.set(value.bytes, entryOffset + 8)
    return dataOffset
  }
  const valueOffset = alignedOffset(dataOffset)
  view.setUint32(entryOffset + 8, valueOffset, true)
  output.set(value.bytes, valueOffset)
  return valueOffset + value.bytes.byteLength
}

export function buildExifProfile(input: ExifProfileInput): Uint8Array {
  const description = asciiBytes(input.description)
  const software = asciiBytes(input.software)
  const xpComment = utf16LeBytes(input.description)
  const userCommentText = utf16LeBytes(input.description)
  const userComment = new Uint8Array(
    USER_COMMENT_UNICODE_PREFIX.byteLength + userCommentText.byteLength,
  )
  userComment.set(USER_COMMENT_UNICODE_PREFIX)
  userComment.set(userCommentText, USER_COMMENT_UNICODE_PREFIX.byteLength)

  const ifd0Values: readonly IfdValue[] = [
    { tag: EXIF_TAG.imageDescription, type: TIFF_TYPE.ascii, bytes: description },
    { tag: EXIF_TAG.software, type: TIFF_TYPE.ascii, bytes: software },
    { tag: EXIF_TAG.xpComment, type: TIFF_TYPE.byte, bytes: xpComment },
  ]
  const ifd0EntryCount = ifd0Values.length + 1
  const ifd0Bytes = 2 + ifd0EntryCount * IFD_ENTRY_BYTES + IFD_TRAILER_BYTES
  const ifd0DataOffset = TIFF_HEADER_BYTES + ifd0Bytes
  const exifIfdOffset = alignedOffset(externalDataEnd(ifd0DataOffset, ifd0Values))
  const exifIfdBytes = 2 + IFD_ENTRY_BYTES + IFD_TRAILER_BYTES
  const userCommentOffset = exifIfdOffset + exifIfdBytes
  const output = new Uint8Array(userCommentOffset + userComment.byteLength)
  const view = new DataView(output.buffer)

  output.set([0x49, 0x49], 0)
  view.setUint16(2, 42, true)
  view.setUint32(4, TIFF_HEADER_BYTES, true)
  view.setUint16(TIFF_HEADER_BYTES, ifd0EntryCount, true)

  let entryOffset = TIFF_HEADER_BYTES + 2
  let dataOffset = ifd0DataOffset
  for (const value of ifd0Values.slice(0, 2)) {
    dataOffset = writeValueEntry(output, entryOffset, value, dataOffset)
    entryOffset += IFD_ENTRY_BYTES
  }
  view.setUint16(entryOffset, EXIF_TAG.exifIfdPointer, true)
  view.setUint16(entryOffset + 2, TIFF_TYPE.long, true)
  view.setUint32(entryOffset + 4, 1, true)
  view.setUint32(entryOffset + 8, exifIfdOffset, true)
  entryOffset += IFD_ENTRY_BYTES
  const xpValue = ifd0Values[2]
  if (xpValue !== undefined) {
    writeValueEntry(output, entryOffset, xpValue, dataOffset)
  }

  view.setUint16(exifIfdOffset, 1, true)
  writeValueEntry(
    output,
    exifIfdOffset + 2,
    { tag: EXIF_TAG.userComment, type: TIFF_TYPE.undefined, bytes: userComment },
    userCommentOffset,
  )
  return output
}
