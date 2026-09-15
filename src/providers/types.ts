import type { ImageCandidate, UnixMilliseconds } from "../shared/contracts"

export type ProviderImage = {
  readonly candidate: ImageCandidate
  readonly proven: boolean
  readonly element: Element
  readonly fullSizeElement?: Element
}

export type ScanResult = {
  readonly prompt: string
  readonly turnId: string
  readonly association: "provider_identity" | "confirmation_required"
  readonly images: readonly ProviderImage[]
}

export type ProviderAdapter = {
  readonly scan: (doc: Document, now: UnixMilliseconds) => readonly ScanResult[]
  readonly readImageBytes?: (image: ProviderImage) => Promise<readonly number[] | undefined>
}
