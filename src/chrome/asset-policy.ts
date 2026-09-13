export type AssetAllowlistEntry = {
  readonly hostname: string
  readonly pathPrefix: string
}

export type AssetPolicyError =
  | { readonly code: "ASSET_NOT_HTTPS" }
  | { readonly code: "ASSET_FORBIDDEN_HOST"; readonly hostname: string }
  | { readonly code: "ASSET_HOST_NOT_ALLOWED"; readonly hostname: string }
  | { readonly code: "ASSET_PATH_NOT_ALLOWED"; readonly hostname: string; readonly path: string }

export type AssetPolicyResult =
  | { readonly kind: "ok"; readonly url: URL }
  | { readonly kind: "rejected"; readonly error: AssetPolicyError }

export type AssetPolicyOptions = {
  readonly allowlist: readonly AssetAllowlistEntry[]
  readonly forbidPrivateHosts: boolean
  readonly requireHttps?: boolean
}

export type AssetPolicy = (url: string) => AssetPolicyResult

function isForbiddenUrlHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true
  if (hostname === "0.0.0.0" || hostname === "127.0.0.1" || hostname === "::1") return true
  if (/^127\./u.test(hostname) || /^10\./u.test(hostname) || /^192\.168\./u.test(hostname)) {
    return true
  }
  if (/^169\.254\./u.test(hostname)) return true
  return /^172\.(1[6-9]|2\d|3[01])\./u.test(hostname)
}

function hostMatches(entry: AssetAllowlistEntry, hostname: string): boolean {
  if (entry.hostname.startsWith("*.")) {
    return hostname.endsWith(`.${entry.hostname.slice(2)}`)
  }
  return entry.hostname === hostname
}

export function createAssetPolicy(options: AssetPolicyOptions): AssetPolicy {
  const requireHttps = options.requireHttps ?? true
  return (url: string): AssetPolicyResult => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { kind: "rejected", error: { code: "ASSET_NOT_HTTPS" } }
    }
    if (requireHttps && parsed.protocol !== "https:") {
      return { kind: "rejected", error: { code: "ASSET_NOT_HTTPS" } }
    }
    if (options.forbidPrivateHosts && isForbiddenUrlHost(parsed.hostname)) {
      return {
        kind: "rejected",
        error: { code: "ASSET_FORBIDDEN_HOST", hostname: parsed.hostname },
      }
    }
    const entry = options.allowlist.find((candidate) => hostMatches(candidate, parsed.hostname))
    if (entry === undefined) {
      return {
        kind: "rejected",
        error: { code: "ASSET_HOST_NOT_ALLOWED", hostname: parsed.hostname },
      }
    }
    if (!parsed.pathname.startsWith(entry.pathPrefix)) {
      return {
        kind: "rejected",
        error: { code: "ASSET_PATH_NOT_ALLOWED", hostname: parsed.hostname, path: parsed.pathname },
      }
    }
    return { kind: "ok", url: parsed }
  }
}

export const PRODUCTION_ASSET_POLICY: AssetPolicy = createAssetPolicy({
  allowlist: [
    { hostname: "chatgpt.com", pathPrefix: "/" },
    { hostname: "gemini.google.com", pathPrefix: "/" },
    { hostname: "grok.com", pathPrefix: "/" },
    { hostname: "*.googleusercontent.com", pathPrefix: "/" },
  ],
  forbidPrivateHosts: true,
})
