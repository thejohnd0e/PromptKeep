import { z } from "zod"
import { LIMITS } from "../shared/contracts"
import { type IptcWriteValues, readIptcValues } from "./iptc-rdf"
import { replaceIptcValues } from "./iptc-rdf-write"
import { parseXmp, type XmpFailure, type XmpResult } from "./xmp-reader"
import { xmpRejected } from "./xmp-types"
import { serializeXmp } from "./xmp-writer"

export { CONTROLLED_DIGITAL_SOURCE_TYPE, IPTC_EXTENSION_NAMESPACE } from "./iptc-rdf"

export type IptcAiInput = {
  readonly prompt: string
  readonly system: string
  readonly observedVersion?: string
}

export type IptcAiMetadata = {
  readonly prompt?: string
  readonly system?: string
  readonly systemVersion?: string
  readonly digitalSourceType?: string
}

const inputSchema = z
  .object({
    prompt: z.string(),
    system: z.string(),
    observedVersion: z.string().optional(),
  })
  .strict()

function isXmlText(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined) return false
    if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) continue
    if (codePoint >= 0x20 && codePoint <= 0xd7ff) continue
    if (codePoint >= 0xe000 && codePoint <= 0xfffd) continue
    if (codePoint >= 0x10000 && codePoint <= 0x10ffff) continue
    return false
  }
  return true
}

export function readIptcAiXmp(input: Uint8Array): XmpResult<IptcAiMetadata> {
  const parsed = parseXmp(input)
  if (parsed.kind === "rejected") return parsed
  return readIptcValues(parsed.value)
}

export function writeIptcAiXmp(input: Uint8Array, values: IptcAiInput): XmpResult<Uint8Array> {
  const validated = inputSchema.safeParse(values)
  if (
    !validated.success ||
    validated.data.prompt.trim() === "" ||
    !isXmlText(validated.data.prompt)
  ) {
    return xmpRejected({ code: "XMP_INVALID_VALUE", field: "prompt" })
  }
  if (validated.data.system.trim() === "" || !isXmlText(validated.data.system)) {
    return xmpRejected({ code: "XMP_INVALID_VALUE", field: "system" })
  }
  if (validated.data.observedVersion !== undefined && !isXmlText(validated.data.observedVersion)) {
    return xmpRejected({ code: "XMP_INVALID_VALUE", field: "version" })
  }
  const promptBytes = new TextEncoder().encode(validated.data.prompt).byteLength
  if (promptBytes > LIMITS.maxPromptUtf8Bytes) {
    return xmpRejected({
      code: "XMP_PROMPT_TOO_LARGE",
      actualBytes: promptBytes,
      limitBytes: LIMITS.maxPromptUtf8Bytes,
    })
  }
  const parsed = parseXmp(input)
  if (parsed.kind === "rejected") return parsed
  const writeValues: IptcWriteValues = {
    prompt: validated.data.prompt,
    system: validated.data.system,
    ...(validated.data.observedVersion === undefined
      ? {}
      : { observedVersion: validated.data.observedVersion }),
  }
  const replaced = replaceIptcValues(parsed.value, writeValues)
  if (replaced.kind === "rejected") return replaced
  const output = serializeXmp(replaced.value)
  if (output.byteLength > LIMITS.maxXmpBytes) {
    return xmpRejected({
      code: "XMP_OUTPUT_TOO_LARGE",
      actualBytes: output.byteLength,
      limitBytes: LIMITS.maxXmpBytes,
    })
  }
  return { kind: "ok", value: output }
}

export type { XmpFailure }
