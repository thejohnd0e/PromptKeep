const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let value = n
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  CRC_TABLE[n] = value >>> 0
}

function update(crc: number, bytes: Uint8Array): number {
  let current = crc
  for (const byte of bytes) {
    current = (CRC_TABLE[(current ^ byte) & 0xff] ?? 0) ^ (current >>> 8)
  }
  return current
}

export function crc32(bytes: Uint8Array): number {
  return (update(0xffffffff, bytes) ^ 0xffffffff) >>> 0
}

export function crc32Chunk(type: Uint8Array, data: Uint8Array): number {
  let crc = update(0xffffffff, type)
  crc = update(crc, data)
  return (crc ^ 0xffffffff) >>> 0
}
