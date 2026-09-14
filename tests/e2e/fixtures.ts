import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { startFixtureServer, type FixtureServer } from "../extension/fixtures-server"

export type ProviderOrigin = "https://chatgpt.com" | "https://gemini.google.com" | "https://grok.com"

export type FixtureHarness = {
  readonly server: FixtureServer
  /** Fetches a fixture page body from the fixture server. */
  readonly page: (route: string) => Promise<string>
  /** Fetches a fixture asset body from the fixture server. */
  readonly asset: (name: string) => Promise<Buffer>
  readonly close: () => Promise<void>
}

export async function startFixtureHarness(): Promise<FixtureHarness> {
  const server = await startFixtureServer()
  const fetchBody = async (path: string): Promise<Buffer> => {
    const response = await fetch(`${server.origin}${path}`)
    if (!response.ok) throw new Error(`fixture ${path} failed: ${String(response.status)}`)
    return Buffer.from(await response.arrayBuffer())
  }
  return {
    server,
    page: async (route) => (await fetchBody(`/${route}`)).toString("utf8"),
    asset: (name) => fetchBody(`/assets/${name}`),
    close: () => server.close(),
  }
}

export type ProviderFixture = {
  readonly origin: ProviderOrigin
  readonly assetOrigin: ProviderOrigin
  readonly pagePath: (route: string) => string
}

const PROVIDER_ORIGINS: Record<string, ProviderOrigin> = {
  chatgpt: "https://chatgpt.com",
  gemini: "https://gemini.google.com",
  grok: "https://grok.com",
}

export function providerFixture(provider: "chatgpt" | "gemini" | "grok"): ProviderFixture {
  const origin = PROVIDER_ORIGINS[provider]
  if (origin === undefined) throw new Error(`unknown provider ${provider}`)
  return {
    origin,
    assetOrigin: origin,
    pagePath: (route) => `${origin}/${route}`,
  }
}

export async function readFixtureAsset(name: string): Promise<Buffer> {
  return readFile(join("tests", "fixtures", "assets", name))
}
