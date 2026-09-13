import {
  LIMITS,
  PROVIDERS,
  type Provider,
  type Sha256Digest,
  sha256Digest,
} from "../shared/contracts"
import { CONTROLLED_DIGITAL_SOURCE_TYPE, readIptcAiXmp, writeIptcAiXmp } from "./iptc-ai"
import { PNG_SIGNATURE, parsePng } from "./png-parser"
import type { PngFailure } from "./png-types"
import { insertXmpItxt } from "./png-writer"
import type { XmpFailure } from "./xmp-types"

export type ReadyAssociation = {
  readonly provider: Provider
  readonly originalPrompt: string
  readonly observedVersion?: string
}

export type EnrichPngOptions = { readonly acknowledgeCaBX?: boolean }

export type SystemLabel = "ChatGPT" | "Google Gemini" | "Grok"

export type EnrichMetadataSummary = {
  readonly prompt: string
  readonly system: SystemLabel
  readonly systemVersion?: string
  readonly digitalSourceType: typeof CONTROLLED_DIGITAL_SOURCE_TYPE
}

export type EnrichPngSuccess = {
  readonly metadata: EnrichMetadataSummary
  readonly outputBytes: Uint8Array
  readonly sourceSha256: Sha256Digest
  readonly outputSha256: Sha256Digest
  readonly c2paStatus: "absent" | "present-unverified-after-modification"
}

export type EnrichPngError =
  | { readonly code: "unsupported_provider"; readonly provider: string }
  | { readonly code: "prompt_missing"; readonly provider: Provider }
  | { readonly code: "prompt_too_large"; readonly actualBytes: number; readonly limitBytes: number }
  | { readonly code: "unsupported_media_type"; readonly mediaType: string }
  | { readonly code: "input_too_large"; readonly actualBytes: number; readonly limitBytes: number }
  | { readonly code: "invalid_png"; readonly reason: string }
  | { readonly code: "unsupported_png"; readonly feature: string }
  | { readonly code: "xmp_too_large"; readonly actualBytes: number; readonly limitBytes: number }
  | { readonly code: "xmp_invalid_value"; readonly field: "prompt" | "system" | "version" }
  | { readonly code: "output_too_large"; readonly actualBytes: number; readonly limitBytes: number }
  | { readonly code: "C2PA_ACK_REQUIRED"; readonly sourceSha256: Sha256Digest }

export type EnrichPngResult =
  | { readonly kind: "ok"; readonly value: EnrichPngSuccess }
  | { readonly kind: "rejected"; readonly error: EnrichPngError }

const SYSTEM_LABELS = { chatgpt: "ChatGPT", gemini: "Google Gemini", grok: "Grok" } as const

const EMPTY_XMP = new TextEncoder().encode(
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description/></rdf:RDF></x:xmpmeta>',
)

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotateRight(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift))
}

function sha256Hex(input: Uint8Array): string {
  const bitLength = input.byteLength * 8
  const paddedLength = Math.ceil((input.byteLength + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(input)
  padded[input.byteLength] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const words = new Uint32Array(64)
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4, false)
    for (let i = 16; i < 64; i++) {
      const w15 = words[i - 15] ?? 0
      const w2 = words[i - 2] ?? 0
      const s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3)
      const s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10)
      words[i] = ((words[i - 16] ?? 0) + s0 + (words[i - 7] ?? 0) + s1) >>> 0
    }
    let a = state[0] ?? 0
    let b = state[1] ?? 0
    let c = state[2] ?? 0
    let d = state[3] ?? 0
    let e = state[4] ?? 0
    let f = state[5] ?? 0
    let g = state[6] ?? 0
    let h = state[7] ?? 0
    for (let i = 0; i < 64; i++) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choose = (e & f) ^ (~e & g)
      const temp1 = (h + sum1 + choose + (SHA256_K[i] ?? 0) + (words[i] ?? 0)) >>> 0
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (sum0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    const newState = [a, b, c, d, e, f, g, h]
    for (let i = 0; i < 8; i++) state[i] = ((state[i] ?? 0) + (newState[i] ?? 0)) >>> 0
  }
  let hex = ""
  for (const word of state) hex += word.toString(16).padStart(8, "0")
  return hex
}

function isPngSignature(input: Uint8Array): boolean {
  if (input.byteLength < PNG_SIGNATURE.byteLength) return false
  for (let i = 0; i < PNG_SIGNATURE.byteLength; i++) if (input[i] !== PNG_SIGNATURE[i]) return false
  return true
}

function detectMediaType(input: Uint8Array): string {
  if (input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return "image/jpeg"
  if (input[0] === 0x47 && input[1] === 0x49 && input[2] === 0x46) return "image/gif"
  return "application/octet-stream"
}

function sizeError(
  code: "prompt_too_large" | "input_too_large" | "xmp_too_large" | "output_too_large",
  actualBytes: number,
  limitBytes: number,
): EnrichPngError {
  return { code, actualBytes, limitBytes } as EnrichPngError
}

function mapPngFailure(error: PngFailure): EnrichPngError {
  switch (error.code) {
    case "PNG_INPUT_TOO_LARGE":
      return sizeError("input_too_large", error.actualBytes, error.limitBytes)
    case "PNG_UNSUPPORTED_APNG":
      return { code: "unsupported_png", feature: "APNG" }
    case "PNG_UNKNOWN_CRITICAL_CHUNK":
      return { code: "unsupported_png", feature: error.chunkType }
    case "PNG_XMP_TOO_LARGE":
      return sizeError("xmp_too_large", error.actualBytes, error.limitBytes)
    case "PNG_OUTPUT_TOO_LARGE":
      return sizeError("output_too_large", error.actualBytes, error.limitBytes)
    default:
      return { code: "invalid_png", reason: error.code }
  }
}

function mapXmpFailure(error: XmpFailure): EnrichPngError {
  switch (error.code) {
    case "XMP_PROMPT_TOO_LARGE":
      return sizeError("prompt_too_large", error.actualBytes, error.limitBytes)
    case "XMP_TOO_LARGE":
    case "XMP_OUTPUT_TOO_LARGE":
      return sizeError("xmp_too_large", error.actualBytes, error.limitBytes)
    case "XMP_INVALID_VALUE":
      return { code: "xmp_invalid_value", field: error.field }
    default:
      return { code: "invalid_png", reason: error.code }
  }
}

function validateAssociation(association: ReadyAssociation): EnrichPngError | undefined {
  if (!PROVIDERS.includes(association.provider)) {
    return { code: "unsupported_provider", provider: association.provider }
  }
  if (association.originalPrompt.trim() === "") {
    return { code: "prompt_missing", provider: association.provider }
  }
  const promptBytes = new TextEncoder().encode(association.originalPrompt).byteLength
  if (promptBytes > LIMITS.maxPromptUtf8Bytes) {
    return sizeError("prompt_too_large", promptBytes, LIMITS.maxPromptUtf8Bytes)
  }
  return undefined
}

export function enrichPng(
  input: Uint8Array,
  association: ReadyAssociation,
  options?: EnrichPngOptions,
): EnrichPngResult {
  const associationError = validateAssociation(association)
  if (associationError !== undefined) return { kind: "rejected", error: associationError }
  if (!isPngSignature(input)) {
    const mediaType = detectMediaType(input)
    return { kind: "rejected", error: { code: "unsupported_media_type", mediaType } }
  }
  if (input.byteLength > LIMITS.maxInputBytes) {
    const error = sizeError("input_too_large", input.byteLength, LIMITS.maxInputBytes)
    return { kind: "rejected", error }
  }
  const parsed = parsePng(input)
  if (parsed.kind === "rejected") return { kind: "rejected", error: mapPngFailure(parsed.error) }
  const sourceSha256 = sha256Digest(sha256Hex(input))
  if (parsed.value.hasCabx && options?.acknowledgeCaBX !== true) {
    return { kind: "rejected", error: { code: "C2PA_ACK_REQUIRED", sourceSha256 } }
  }
  const system = SYSTEM_LABELS[association.provider]
  const existingXmp = parsed.value.xmp?.data ?? EMPTY_XMP
  const version =
    association.observedVersion?.trim() === "" ? undefined : association.observedVersion
  const written = writeIptcAiXmp(existingXmp, {
    prompt: association.originalPrompt,
    system,
    ...(version === undefined ? {} : { observedVersion: version }),
  })
  if (written.kind === "rejected") return { kind: "rejected", error: mapXmpFailure(written.error) }
  const inserted = insertXmpItxt(input, written.value)
  if (inserted.kind === "rejected")
    return { kind: "rejected", error: mapPngFailure(inserted.error) }
  const output = inserted.value
  const reparsed = parsePng(output)
  if (reparsed.kind === "rejected") {
    const reason = `output_reparse_${reparsed.error.code}`
    return { kind: "rejected", error: { code: "invalid_png", reason } }
  }
  const outputXmp = reparsed.value.xmp?.data
  if (outputXmp === undefined) {
    return { kind: "rejected", error: { code: "invalid_png", reason: "output_xmp_missing" } }
  }
  const read = readIptcAiXmp(outputXmp)
  if (read.kind === "rejected") return { kind: "rejected", error: mapXmpFailure(read.error) }
  const values = read.value
  if (values.prompt === undefined || values.system !== system) {
    return { kind: "rejected", error: { code: "invalid_png", reason: "output_metadata_missing" } }
  }
  if (values.digitalSourceType !== CONTROLLED_DIGITAL_SOURCE_TYPE) {
    return { kind: "rejected", error: { code: "invalid_png", reason: "output_metadata_missing" } }
  }
  const metadata: EnrichMetadataSummary = {
    prompt: values.prompt,
    system,
    ...(values.systemVersion === undefined ? {} : { systemVersion: values.systemVersion }),
    digitalSourceType: CONTROLLED_DIGITAL_SOURCE_TYPE,
  }
  return {
    kind: "ok",
    value: {
      metadata,
      outputBytes: output,
      sourceSha256,
      outputSha256: sha256Digest(sha256Hex(output)),
      c2paStatus: reparsed.value.hasCabx ? "present-unverified-after-modification" : "absent",
    },
  }
}
