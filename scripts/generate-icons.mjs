import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import process from "node:process"
import { deflateSync } from "node:zlib"

const OUT_DIR = resolve(process.cwd(), "src/chrome/icons")
const SIZES = [16, 32, 48, 128]
const SUPERSAMPLE = 4

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii")
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  typeBytes.copy(out, 4)
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length)
  return out
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSq = dx * dx + dy * dy
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function renderIcon(size) {
  const big = size * SUPERSAMPLE
  const rgba = Buffer.alloc(big * big * 4)
  const center = big / 2
  const radius = big / 2 - big * 0.02
  const ringWidth = big * 0.03
  const strokeWidth = big * 0.1

  const apex = [0.5, 0.21]
  const leftFoot = [0.27, 0.8]
  const rightFoot = [0.73, 0.8]
  const crossLeft = [0.36, 0.62]
  const crossRight = [0.64, 0.62]

  for (let y = 0; y < big; y += 1) {
    for (let x = 0; x < big; x += 1) {
      const px = x + 0.5
      const py = y + 0.5
      const distCenter = Math.hypot(px - center, py - center)
      if (distCenter > radius) continue

      const nx = px / big
      const ny = py / big
      const dLeft = distanceToSegment(nx, ny, leftFoot[0], leftFoot[1], apex[0], apex[1])
      const dRight = distanceToSegment(nx, ny, rightFoot[0], rightFoot[1], apex[0], apex[1])
      const dCross = distanceToSegment(
        nx,
        ny,
        crossLeft[0],
        crossLeft[1],
        crossRight[0],
        crossRight[1],
      )
      const isLetter = Math.min(dLeft, dRight, dCross) <= strokeWidth / big / 2
      const isRing = distCenter >= radius - ringWidth

      const idx = (y * big + x) * 4
      if (isLetter) {
        rgba[idx] = 0
        rgba[idx + 1] = 0
        rgba[idx + 2] = 0
      } else if (isRing) {
        rgba[idx] = 190
        rgba[idx + 1] = 190
        rgba[idx + 2] = 190
      } else {
        rgba[idx] = 255
        rgba[idx + 1] = 255
        rgba[idx + 2] = 255
      }
      rgba[idx + 3] = 255
    }
  }

  const out = Buffer.alloc(size * size * 4)
  const samples = SUPERSAMPLE * SUPERSAMPLE
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const idx = ((y * SUPERSAMPLE + sy) * big + (x * SUPERSAMPLE + sx)) * 4
          r += rgba[idx]
          g += rgba[idx + 1]
          b += rgba[idx + 2]
          a += rgba[idx + 3]
        }
      }
      const outIdx = (y * size + x) * 4
      out[outIdx] = Math.round(r / samples)
      out[outIdx + 1] = Math.round(g / samples)
      out[outIdx + 2] = Math.round(b / samples)
      out[outIdx + 3] = Math.round(a / samples)
    }
  }
  return out
}

mkdirSync(OUT_DIR, { recursive: true })
for (const size of SIZES) {
  const bytes = encodePng(size, size, renderIcon(size))
  const file = resolve(OUT_DIR, `icon-${String(size)}.png`)
  writeFileSync(file, bytes)
  console.log(`wrote ${file} (${String(bytes.length)} bytes)`)
}
