import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import process from "node:process"

const OUT_DIR = resolve(process.cwd(), "src/chrome/icons")
const SOURCE = resolve(process.cwd(), "promptkeep-icon-source.png")
const SIZES = [16, 32, 48, 128]

mkdirSync(OUT_DIR, { recursive: true })
for (const size of SIZES) {
  const file = resolve(OUT_DIR, `icon-${String(size)}.png`)
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    SOURCE,
    "-vf",
    `crop=748:748:252:248,scale=${String(size)}:${String(size)}:flags=lanczos`,
    "-frames:v",
    "1",
    "-f",
    "image2",
    file,
  ])
  console.log(`wrote ${file}`)
}
