import { type IptcAiMetadata, readIptcAiXmp } from "../../src/metadata/iptc-ai"
import { type PngFailure, parsePng } from "../../src/metadata/png-parser"
import type { XmpFailure } from "../../src/metadata/xmp-reader"

export type ReadAiMetadataValue = IptcAiMetadata & {
  readonly prompt: string
  readonly system: string
  readonly digitalSourceType: string
}

export type ReadAiMetadataError = PngFailure | XmpFailure

export type ReadAiMetadataResult =
  | { readonly kind: "present"; readonly value: ReadAiMetadataValue }
  | { readonly kind: "absent" }
  | { readonly kind: "malformed"; readonly error: ReadAiMetadataError }
  | { readonly kind: "unsupported"; readonly error: ReadAiMetadataError }

const UNSUPPORTED_CODES = new Set([
  "PNG_UNSUPPORTED_APNG",
  "PNG_UNKNOWN_CRITICAL_CHUNK",
  "PNG_INPUT_TOO_LARGE",
  "PNG_XMP_TOO_LARGE",
  "PNG_TOO_MANY_CHUNKS",
])

function classify(error: ReadAiMetadataError): "malformed" | "unsupported" {
  return UNSUPPORTED_CODES.has(error.code) ? "unsupported" : "malformed"
}

export function readAiMetadata(pngBytes: Uint8Array): ReadAiMetadataResult {
  const parsed = parsePng(pngBytes)
  if (parsed.kind === "rejected") {
    return { kind: classify(parsed.error), error: parsed.error }
  }
  const xmp = parsed.value.xmp?.data
  if (xmp === undefined) return { kind: "absent" }
  const read = readIptcAiXmp(xmp)
  if (read.kind === "rejected") {
    return { kind: classify(read.error), error: read.error }
  }
  const { prompt, system, systemVersion, digitalSourceType } = read.value
  if (prompt === undefined || system === undefined || digitalSourceType === undefined) {
    return { kind: "absent" }
  }
  return {
    kind: "present",
    value: {
      prompt,
      system,
      ...(systemVersion === undefined ? {} : { systemVersion }),
      digitalSourceType,
    },
  }
}
