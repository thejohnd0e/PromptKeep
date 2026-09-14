import { createServer, type Server } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
}

export type FixtureServer = {
  readonly origin: string
  readonly close: () => Promise<void>
}

const PROVIDER_ROUTES = [
  "chatgpt/success",
  "chatgpt/ambiguous",
  "chatgpt/html-asset",
  "chatgpt/malformed-png",
  "gemini/success",
  "gemini/thumbnail-only",
  "gemini/html-asset",
  "grok/success",
  "grok/stale-previous",
  "grok/html-asset",
] as const

export type FixtureRoute = (typeof PROVIDER_ROUTES)[number]

/**
 * Serves versioned provider-like DOM pages plus real PNG assets for the E2E
 * specs and the F3 manual QA flow. The E2E specs fetch fixture content from
 * this server and fulfill Playwright routes under the real provider origins
 * (the content script only matches chatgpt.com / gemini.google.com / grok.com,
 * so the pages must be served under those hostnames for injection to happen).
 */
export function startFixtureServer(port = 0, host = "127.0.0.1"): Promise<FixtureServer> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", `http://${host}`)
        const pathname = normalize(url.pathname).replaceAll("\\", "/")
        if (pathname.startsWith("/assets/")) {
          const assetName = pathname.slice("/assets/".length)
          if (assetName.includes("..")) {
            response.writeHead(400).end()
            return
          }
          const body = await readFile(join("tests", "fixtures", "assets", assetName))
          response.writeHead(200, { "content-type": MIME_TYPES[extname(assetName)] ?? "application/octet-stream" })
          response.end(body)
          return
        }
        const route = pathname.replace(/^\//u, "").replace(/\/$/u, "")
        if (!(PROVIDER_ROUTES as readonly string[]).includes(route)) {
          response.writeHead(404, { "content-type": "text/plain" }).end("not found")
          return
        }
        const body = await readFile(join("tests", "fixtures", "pages", `${route.replaceAll("/", "-")}.html`), "utf8")
        response.writeHead(200, { "content-type": MIME_TYPES[".html"] })
        response.end(body)
      } catch {
        response.writeHead(500, { "content-type": "text/plain" }).end("fixture error")
      }
    })
    server.once("error", reject)
    server.listen(port, host, () => {
      const address = server.address()
      const resolvedPort = typeof address === "object" && address !== null ? address.port : port
      resolve({
        origin: `http://${host}:${resolvedPort}`,
        close: () =>
          new Promise((resolveClose, rejectClose) => {
            server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)))
          }),
      })
    })
  })
}
