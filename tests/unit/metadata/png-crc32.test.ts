import { describe, expect, it } from "vitest"
import { crc32, crc32Chunk } from "../../../src/metadata/crc32"

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

describe("Given the PNG CRC-32 implementation", () => {
  it("when computing the empty input then it returns zero", () => {
    expect(crc32(new Uint8Array(0))).toBe(0x00000000)
  })

  it("when computing the standard check value then it matches the CRC-32 reference", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926)
  })

  it("when computing a known sentence then it matches the published CRC-32", () => {
    expect(crc32(bytes("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339)
  })

  it("when computing a chunk CRC then it equals the CRC over type plus data", () => {
    const type = bytes("iTXt")
    const data = bytes("hello")
    expect(crc32Chunk(type, data)).toBe(crc32(new Uint8Array([...type, ...data])))
  })

  it("when the same bytes are hashed twice then the result is identical", () => {
    const input = bytes("repeat me")
    expect(crc32(input)).toBe(crc32(input))
  })
})
