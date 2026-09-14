import type { OperationNonce } from "./contracts"

const CACHE_NAME = "aip2e-asset-transfer-v1"
const CACHE_ORIGIN = "https://asset-transfer.invalid/"

export type AssetTransferStore = {
  readonly save: (nonce: OperationNonce, bytes: Uint8Array) => Promise<void>
  readonly take: (nonce: OperationNonce) => Promise<Uint8Array | undefined>
  readonly delete: (nonce: OperationNonce) => Promise<void>
}

function cacheKey(nonce: OperationNonce): string {
  return `${CACHE_ORIGIN}${nonce}`
}

export function createAssetTransferStore(cacheStorage: CacheStorage): AssetTransferStore {
  return {
    save: async (nonce, bytes) => {
      const cache = await cacheStorage.open(CACHE_NAME)
      await cache.put(cacheKey(nonce), new Response(bytes.slice().buffer))
    },
    take: async (nonce) => {
      const cache = await cacheStorage.open(CACHE_NAME)
      const response = await cache.match(cacheKey(nonce))
      if (response === undefined) return undefined
      const bytes = new Uint8Array(await response.arrayBuffer())
      await cache.delete(cacheKey(nonce))
      return bytes
    },
    delete: async (nonce) => {
      const cache = await cacheStorage.open(CACHE_NAME)
      await cache.delete(cacheKey(nonce))
    },
  }
}
