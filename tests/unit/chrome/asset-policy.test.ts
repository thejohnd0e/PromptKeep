import { describe, expect, it } from "vitest"
import { createAssetPolicy, PRODUCTION_ASSET_POLICY } from "../../../src/chrome/asset-policy"

const testPolicy = createAssetPolicy({
  allowlist: [
    { hostname: "chatgpt.com", pathPrefix: "/" },
    { hostname: "*.googleusercontent.com", pathPrefix: "/" },
    { hostname: "127.0.0.1", pathPrefix: "/assets/" },
  ],
  forbidPrivateHosts: true,
})

const permissivePolicy = createAssetPolicy({
  allowlist: [{ hostname: "127.0.0.1", pathPrefix: "/" }],
  forbidPrivateHosts: false,
  requireHttps: false,
})

const pathPolicy = createAssetPolicy({
  allowlist: [{ hostname: "127.0.0.1", pathPrefix: "/assets/" }],
  forbidPrivateHosts: false,
})

describe("asset policy", () => {
  it("accepts an allowlisted https URL", () => {
    const result = testPolicy("https://chatgpt.com/asset/1.png")
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") {
      expect(result.url.hostname).toBe("chatgpt.com")
    }
  })

  it("accepts a wildcard subdomain of an allowlisted base", () => {
    const result = testPolicy("https://cdn.googleusercontent.com/gg-dl/1.png")
    expect(result.kind).toBe("ok")
  })

  it("rejects the bare wildcard base host", () => {
    const result = testPolicy("https://googleusercontent.com/gg-dl/1.png")
    expect(result).toEqual({
      kind: "rejected",
      error: { code: "ASSET_HOST_NOT_ALLOWED", hostname: "googleusercontent.com" },
    })
  })

  it("rejects a non-https URL", () => {
    const result = testPolicy("http://chatgpt.com/asset/1.png")
    expect(result).toEqual({ kind: "rejected", error: { code: "ASSET_NOT_HTTPS" } })
  })

  it("rejects a non-URL string", () => {
    const result = testPolicy("not-a-url")
    expect(result).toEqual({ kind: "rejected", error: { code: "ASSET_NOT_HTTPS" } })
  })

  it("rejects a private host when forbidPrivateHosts is true", () => {
    const result = testPolicy("https://127.0.0.1/assets/1.png")
    expect(result).toEqual({
      kind: "rejected",
      error: { code: "ASSET_FORBIDDEN_HOST", hostname: "127.0.0.1" },
    })
  })

  it("rejects localhost", () => {
    const result = testPolicy("https://localhost/assets/1.png")
    expect(result).toEqual({
      kind: "rejected",
      error: { code: "ASSET_FORBIDDEN_HOST", hostname: "localhost" },
    })
  })

  it("rejects a path outside the allowlisted prefix", () => {
    const result = pathPolicy("https://127.0.0.1/other/1.png")
    expect(result).toEqual({
      kind: "rejected",
      error: { code: "ASSET_PATH_NOT_ALLOWED", hostname: "127.0.0.1", path: "/other/1.png" },
    })
  })

  it("accepts a path under the allowlisted prefix", () => {
    const result = pathPolicy("https://127.0.0.1/assets/1.png")
    expect(result.kind).toBe("ok")
  })

  it("allows a private host when forbidPrivateHosts is false and https is not required", () => {
    const result = permissivePolicy("http://127.0.0.1:8080/asset.png")
    expect(result.kind).toBe("ok")
  })

  it("rejects a host outside the allowlist", () => {
    const result = testPolicy("https://evil.example.com/phish.png")
    expect(result).toEqual({
      kind: "rejected",
      error: { code: "ASSET_HOST_NOT_ALLOWED", hostname: "evil.example.com" },
    })
  })

  it("production policy rejects a private host", () => {
    const result = PRODUCTION_ASSET_POLICY("https://127.0.0.1/secret.png")
    expect(result).toEqual({
      kind: "rejected",
      error: { code: "ASSET_FORBIDDEN_HOST", hostname: "127.0.0.1" },
    })
  })

  it("production policy rejects a non-allowlisted host", () => {
    const result = PRODUCTION_ASSET_POLICY("https://evil.example.com/phish.png")
    expect(result).toEqual({
      kind: "rejected",
      error: { code: "ASSET_HOST_NOT_ALLOWED", hostname: "evil.example.com" },
    })
  })

  it("production policy accepts a googleusercontent asset host", () => {
    const result = PRODUCTION_ASSET_POLICY("https://lh3.googleusercontent.com/gg-dl/1.png")
    expect(result.kind).toBe("ok")
  })
})
