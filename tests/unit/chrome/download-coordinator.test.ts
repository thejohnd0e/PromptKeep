import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { createAssetPolicy } from "../../../src/chrome/asset-policy"
import { createAssetFetcher, createDownloader } from "../../../src/chrome/download-coordinator"
import { imageUrl } from "../../../src/shared/contracts"
import { buildValidPng } from "../../fixtures/png/png-fixtures"

const pngBytes = buildValidPng()

const testPolicy = createAssetPolicy({
  allowlist: [{ hostname: "127.0.0.1", pathPrefix: "/" }],
  forbidPrivateHosts: false,
  requireHttps: false,
})

const servers: Server[] = []

afterEach(async () => {
  for (const server of servers) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  servers.length = 0
})

async function startServer(
  handler: (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ) => void,
) {
  const requests: string[] = []
  const server = createServer((req, res) => {
    requests.push(req.url ?? "")
    res.on("error", () => {})
    handler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  servers.push(server)
  const address = server.address() as AddressInfo
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests }
}

describe("asset fetcher", () => {
  it("fetches exact bytes from an allowlisted local server", async () => {
    const { baseUrl } = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "image/png" })
      res.end(Buffer.from(pngBytes))
    })
    const fetcher = createAssetFetcher({
      policy: testPolicy,
      fetchImpl: fetch,
      maxBytes: 1024,
      timeoutMilliseconds: 1_000,
      retryCount: 0,
    })
    const result = await fetcher(imageUrl(`${baseUrl}/asset.png`))
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.bytes).toEqual(pngBytes)
    }
  })

  it("denies any redirect without following it", async () => {
    const { baseUrl, requests } = await startServer((req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { location: "/secret" })
        res.end()
        return
      }
      res.writeHead(200, { "content-type": "image/png" })
      res.end(Buffer.from(pngBytes))
    })
    const fetcher = createAssetFetcher({
      policy: testPolicy,
      fetchImpl: fetch,
      maxBytes: 1024,
      timeoutMilliseconds: 1_000,
      retryCount: 0,
    })
    const result = await fetcher(imageUrl(`${baseUrl}/start`))
    expect(result).toEqual({ kind: "rejected", error: { code: "ASSET_REDIRECT_DENIED" } })
    expect(requests).toEqual(["/start"])
  })

  it("rejects a non-ok status", async () => {
    const { baseUrl } = await startServer((_req, res) => {
      res.writeHead(401, { "content-type": "text/html" })
      res.end("<html>unauthorized</html>")
    })
    const fetcher = createAssetFetcher({
      policy: testPolicy,
      fetchImpl: fetch,
      maxBytes: 1024,
      timeoutMilliseconds: 1_000,
      retryCount: 0,
    })
    const result = await fetcher(imageUrl(`${baseUrl}/auth.png`))
    expect(result).toEqual({ kind: "rejected", error: { code: "ASSET_BAD_STATUS", status: 401 } })
  })

  it("rejects a non-png content type", async () => {
    const { baseUrl } = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" })
      res.end("<html>not an image</html>")
    })
    const fetcher = createAssetFetcher({
      policy: testPolicy,
      fetchImpl: fetch,
      maxBytes: 1024,
      timeoutMilliseconds: 1_000,
      retryCount: 0,
    })
    const result = await fetcher(imageUrl(`${baseUrl}/page.html`))
    expect(result).toEqual({
      kind: "rejected",
      error: { code: "ASSET_BAD_MEDIA_TYPE", mediaType: "text/html" },
    })
  })

  it("accepts a png with no content-type header", async () => {
    const { baseUrl } = await startServer((_req, res) => {
      res.writeHead(200)
      res.end(Buffer.from(pngBytes))
    })
    const fetcher = createAssetFetcher({
      policy: testPolicy,
      fetchImpl: fetch,
      maxBytes: 1024,
      timeoutMilliseconds: 1_000,
      retryCount: 0,
    })
    const result = await fetcher(imageUrl(`${baseUrl}/png.png`))
    expect(result.kind).toBe("ok")
  })

  it("rejects bytes that are not a PNG despite an image/png content type", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
    const { baseUrl } = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "image/png" })
      res.end(Buffer.from(jpeg))
    })
    const fetcher = createAssetFetcher({
      policy: testPolicy,
      fetchImpl: fetch,
      maxBytes: 1024,
      timeoutMilliseconds: 1_000,
      retryCount: 0,
    })
    const result = await fetcher(imageUrl(`${baseUrl}/fake.png`))
    expect(result).toEqual({
      kind: "rejected",
      error: { code: "ASSET_NOT_PNG", mediaType: "image/jpeg" },
    })
  })

  it("rejects a body whose content-length exceeds the cap before reading", async () => {
    const { baseUrl } = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "image/png", "content-length": "1000" })
      res.end(Buffer.from(pngBytes))
    })
    const fetcher = createAssetFetcher({
      policy: testPolicy,
      fetchImpl: fetch,
      maxBytes: 100,
      timeoutMilliseconds: 1_000,
      retryCount: 0,
    })
    const result = await fetcher(imageUrl(`${baseUrl}/big.png`))
    expect(result).toEqual({
      kind: "rejected",
      error: { code: "ASSET_TOO_LARGE", actualBytes: 1000, limitBytes: 100 },
    })
  })

  it("rejects a body that exceeds the stream cap", async () => {
    const { baseUrl } = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "image/png" })
      res.end(Buffer.from(pngBytes))
    })
    const fetcher = createAssetFetcher({
      policy: testPolicy,
      fetchImpl: fetch,
      maxBytes: 10,
      timeoutMilliseconds: 1_000,
      retryCount: 0,
    })
    const result = await fetcher(imageUrl(`${baseUrl}/big.png`))
    expect(result).toMatchObject({
      kind: "rejected",
      error: { code: "ASSET_TOO_LARGE", limitBytes: 10 },
    })
    if (result.kind === "rejected" && result.error.code === "ASSET_TOO_LARGE") {
      expect(result.error.actualBytes).toBeGreaterThan(10)
    }
  })

  it("times out a fetch that never responds", async () => {
    const { baseUrl } = await startServer(() => {
      // never respond
    })
    const fetcher = createAssetFetcher({
      policy: testPolicy,
      fetchImpl: fetch,
      maxBytes: 1024,
      timeoutMilliseconds: 50,
      retryCount: 0,
    })
    const result = await fetcher(imageUrl(`${baseUrl}/slow.png`))
    expect(result).toEqual({ kind: "rejected", error: { code: "ASSET_TIMEOUT" } })
  })

  it("reports caller cancellation before the fetch starts", async () => {
    const { baseUrl } = await startServer(() => {
      // never respond
    })
    const fetcher = createAssetFetcher({
      policy: testPolicy,
      fetchImpl: fetch,
      maxBytes: 1024,
      timeoutMilliseconds: 5_000,
      retryCount: 0,
    })
    const controller = new AbortController()
    controller.abort()
    const result = await fetcher(imageUrl(`${baseUrl}/slow.png`), controller.signal)
    expect(result).toEqual({ kind: "rejected", error: { code: "ASSET_CANCELLED" } })
  })

  it("reports cancellation while the body is streaming", async () => {
    const { baseUrl } = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "image/png" })
      res.write(new Uint8Array(1024))
      // keep the stream open
    })
    const fetcher = createAssetFetcher({
      policy: testPolicy,
      fetchImpl: fetch,
      maxBytes: 1024 * 1024,
      timeoutMilliseconds: 5_000,
      retryCount: 0,
    })
    const controller = new AbortController()
    const resultPromise = fetcher(imageUrl(`${baseUrl}/stream.png`), controller.signal)
    setTimeout(() => controller.abort(), 50)
    const result = await resultPromise
    expect(result).toEqual({ kind: "rejected", error: { code: "ASSET_CANCELLED" } })
  })

  it("propagates a policy rejection without fetching", async () => {
    const fetcher = createAssetFetcher({
      policy: () => ({
        kind: "rejected",
        error: { code: "ASSET_HOST_NOT_ALLOWED", hostname: "evil.example.com" },
      }),
      fetchImpl: async () => {
        throw new Error("must not be called")
      },
      maxBytes: 1024,
      timeoutMilliseconds: 1_000,
      retryCount: 0,
    })
    const result = await fetcher(imageUrl("https://evil.example.com/phish.png"))
    expect(result).toEqual({
      kind: "rejected",
      error: { code: "ASSET_HOST_NOT_ALLOWED", hostname: "evil.example.com" },
    })
  })

  it("retries the same immutable descriptor once on a transient failure", async () => {
    const urls: string[] = []
    let calls = 0
    const fetchImpl = async (url: string) => {
      urls.push(url)
      calls += 1
      if (calls === 1) throw new TypeError("network down")
      return new Response(pngBytes.slice(), {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    }
    const fetcher = createAssetFetcher({
      policy: testPolicy,
      fetchImpl,
      maxBytes: 1024,
      timeoutMilliseconds: 1_000,
      retryCount: 1,
    })
    const result = await fetcher(imageUrl("http://127.0.0.1:8080/asset.png"))
    expect(result.kind).toBe("ok")
    expect(urls).toEqual(["http://127.0.0.1:8080/asset.png", "http://127.0.0.1:8080/asset.png"])
  })

  it("reports a network failure when retries are exhausted", async () => {
    const fetchImpl = async () => {
      throw new TypeError("network down")
    }
    const fetcher = createAssetFetcher({
      policy: testPolicy,
      fetchImpl,
      maxBytes: 1024,
      timeoutMilliseconds: 1_000,
      retryCount: 0,
    })
    const result = await fetcher(imageUrl("http://127.0.0.1:8080/asset.png"))
    expect(result).toEqual({ kind: "rejected", error: { code: "ASSET_FETCH_FAILED" } })
  })
})

describe("downloader", () => {
  it("downloads bytes under a uniquify filename and revokes the blob url", async () => {
    const created: string[] = []
    const revoked: string[] = []
    const downloader = createDownloader({
      createObjectUrl: (blob) => {
        created.push(blob.type)
        return "blob:test-1"
      },
      revokeObjectUrl: (url) => revoked.push(url),
      download: async (options) => {
        expect(options).toEqual({
          url: "blob:test-1",
          filename: "corgi-ai-prompt.png",
          conflictAction: "uniquify",
        })
        return 42
      },
      waitForDownload: async (id) => {
        expect(id).toBe(42)
        return { kind: "completed" }
      },
    })
    const result = await downloader(pngBytes, "corgi")
    expect(result).toEqual({ kind: "ok", downloadId: 42 })
    expect(created).toEqual(["image/png"])
    expect(revoked).toEqual(["blob:test-1"])
  })

  it("sanitizes forbidden filename characters", async () => {
    const filenames: string[] = []
    const downloader = createDownloader({
      createObjectUrl: () => "blob:test",
      revokeObjectUrl: () => {},
      download: async (options) => {
        filenames.push(options.filename ?? "")
        return 1
      },
      waitForDownload: async () => ({ kind: "completed" }),
    })
    await downloader(pngBytes, 'a<b>c:d"e/f\\g|h?i*j')
    expect(filenames).toEqual(["abcdefghij-ai-prompt.png"])
  })

  it("trims edge dots and spaces from the filename base", async () => {
    const filenames: string[] = []
    const downloader = createDownloader({
      createObjectUrl: () => "blob:test",
      revokeObjectUrl: () => {},
      download: async (options) => {
        filenames.push(options.filename ?? "")
        return 1
      },
      waitForDownload: async () => ({ kind: "completed" }),
    })
    await downloader(pngBytes, "  ..corgi..  ")
    expect(filenames).toEqual(["corgi-ai-prompt.png"])
  })

  it("falls back to a safe base when the filename is entirely invalid", async () => {
    const filenames: string[] = []
    const downloader = createDownloader({
      createObjectUrl: () => "blob:test",
      revokeObjectUrl: () => {},
      download: async (options) => {
        filenames.push(options.filename ?? "")
        return 1
      },
      waitForDownload: async () => ({ kind: "completed" }),
    })
    await downloader(pngBytes, "///")
    expect(filenames).toEqual(["image-ai-prompt.png"])
  })

  it("maps a user-cancelled download to DOWNLOAD_CANCELLED", async () => {
    const downloader = createDownloader({
      createObjectUrl: () => "blob:test",
      revokeObjectUrl: () => {},
      download: async () => 7,
      waitForDownload: async () => ({ kind: "interrupted", error: "USER_CANCELED" }),
    })
    const result = await downloader(pngBytes, "corgi")
    expect(result).toEqual({ kind: "rejected", error: { code: "DOWNLOAD_CANCELLED" } })
  })

  it("maps a failed download to DOWNLOAD_FAILED", async () => {
    const downloader = createDownloader({
      createObjectUrl: () => "blob:test",
      revokeObjectUrl: () => {},
      download: async () => 7,
      waitForDownload: async () => ({ kind: "interrupted", error: "NETWORK_FAILED" }),
    })
    const result = await downloader(pngBytes, "corgi")
    expect(result).toEqual({ kind: "rejected", error: { code: "DOWNLOAD_FAILED" } })
  })

  it("reports DOWNLOAD_FAILED when the download API rejects", async () => {
    const downloader = createDownloader({
      createObjectUrl: () => "blob:test",
      revokeObjectUrl: () => {},
      download: async () => {
        throw new Error("downloads unavailable")
      },
      waitForDownload: async () => ({ kind: "completed" }),
    })
    const result = await downloader(pngBytes, "corgi")
    expect(result).toEqual({ kind: "rejected", error: { code: "DOWNLOAD_FAILED" } })
  })

  it("revokes the blob url even when the download fails", async () => {
    const revoked: string[] = []
    const downloader = createDownloader({
      createObjectUrl: () => "blob:test",
      revokeObjectUrl: (url) => revoked.push(url),
      download: async () => {
        throw new Error("boom")
      },
      waitForDownload: async () => ({ kind: "completed" }),
    })
    const result = await downloader(pngBytes, "corgi")
    expect(result.kind).toBe("rejected")
    expect(revoked).toEqual(["blob:test"])
  })
})
