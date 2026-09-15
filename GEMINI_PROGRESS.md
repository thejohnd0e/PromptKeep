# Gemini support progress handoff

## Latest state: 2026-09-15, version 1.18

Gemini full-resolution PNG capture was confirmed live by the user. Prompt extraction is updated
for current Gemini markup: `.query-text` contains a screen-reader heading (`You said` plus the
prompt) and a visible `.query-text-line` containing the same prompt. The adapter now reads the
visible line first and retains `.query-text` only as a fallback for older markup. This prevents
both the `You said` prefix and duplicate prompt text. ChatGPT and Grok extraction are unchanged.

Selector schema version is 2. The full-size Gemini browser fixture now uses the current duplicated
accessibility markup and verifies one clean prompt in PNG iTXt, XMP, and EXIF. Extension version is
1.18 and must be reloaded manually before live verification.

## Latest state: 2026-09-15, version 1.17

User confirmed ChatGPT downloads work. Keep its URL-based mechanism separate from Gemini.
The Gemini failure was reproduced live on 1.16: a native full-size JPEG downloaded alongside
a smaller PNG with prompt metadata. One observed PNG was 687x1024; the user's later example
was a 1792x2400 JPEG and a 765x1024 PNG.

### Confirmed cause

Gemini's public client module uses SafeDownloader, which sends the full-size Blob and filename
through MessagePort.postMessage to an isolated sandbox. The sandbox creates its own anchor
and object URL. The old main-page Blob interception missed that download and could capture
an unrelated preview instead. A five-second timeout could also fall back to a denied asset URL.

### Implemented in 1.17

- `src/providers/types.ts`: common scan and optional image-byte reader contract.
- `src/providers/registry.ts`: explicit adapter registration for ChatGPT, Gemini, and Grok.
- `src/providers/gemini/download.ts`: Gemini-only native capture orchestration, 30-second timeout,
  one active capture, and explicit errors instead of saving a preview on capture failure.
- `src/providers/gemini/page-download-capture.js`: capture the SafeDownloader Blob/filename message,
  acknowledge its reply port, and suppress the original raw download. Only runs on Gemini.
  Direct anchor downloads remain supported. Creating a Blob/object URL alone no longer captures it.
- `src/chrome/content.ts` and `src/content/controller.ts`: select and invoke the adapter;
  no Gemini-specific download logic in the common controller. ChatGPT/Grok keep URL downloads.
- `scripts/build.mjs`: copies the Gemini bridge from its provider directory.
- `src/chrome/manifest.json` and built manifest: version 1.17; no new permissions.

The background/offscreen PNG conversion and metadata pipeline were not changed in this iteration.

### Verification

- Regression test failed on 1.16: returned the 8x8 preview instead of the fixture's full-size image.
- `npm run test:unit`: 376 tests passed across 30 files.
- `npm run typecheck`, `npm run build`, `npm run verify:manifest`: passed.
- `npx playwright test tests/e2e/chatgpt.spec.ts tests/e2e/gemini.spec.ts`: 6 passed.
- Gemini sandbox scenario uses a real isolated iframe, delayed JPEG delivery (6 seconds),
  and an unrelated preview Blob. Output is exactly one PNG at 1792x2400, with prompt verified
  in parameters, XMP, and EXIF. Native downloader acknowledgement is also checked.
- All changed TypeScript/JavaScript files pass Biome; changed code modules are under 200 pure LOC.
- Existing build warnings about node:zlib externalization and inlineDynamicImports remain.

Live verification of 1.17 awaits the user's manual reload of the unpacked extension and provider
tabs. The agent cannot operate chrome://extensions through the available browser tool.
Ask for a reload only if 1.17 has not already been loaded; then test Download with prompt and
check output dimensions, metadata, and file count. Do not confuse the unmodified native button
with the extension button.

## Historical notes below (through 1.15)

Date: 2026-09-14
Project: `D:\MyProjects\AIprompt2exif`

## Current user-visible symptom

After reloading the extension and Gemini tab, the live Gemini page still reports:

```text
download_failed
Download failed before image bytes were available: ASSET_REDIRECT_DENIED.
```

This means the extension is still taking the URL-fetch path for the current image candidate, and the background fetch sees a redirect it refuses or cannot inspect safely. In an earlier live DOM probe, Gemini rendered the generated image as:

```text
blob:https://gemini.google.com/...
class="image animate loaded"
alt=", AI generated"
```

with a native `button[aria-label*="Download full size image"]` that has no `href`.

## Version rule

User asked: increment extension version by `0.01` each iteration.

Source/build version at the historical handoff: `1.15`; latest is `1.17` above.

Files:

- `src/chrome/manifest.json`
- `dist/chrome/manifest.json`

## Implemented changes so far

### Gemini UI placement

- `src/content/image-action.ts`
- Gemini overlay button moved lower on the right: `top: 44px; right: 8px`.
- Reason: top-left is occupied by Pinterest; original top-right overlapped Gemini native download.

### Gemini full-size href support

- `src/providers/gemini/adapter.ts`
- `imageDescriptor` now prefers a nearby download control `href` when present, falling back to image `src`.
- Added fixture:
  - `tests/fixtures/providers/gemini/full-size-separate-asset.html`
- Added unit test in:
  - `tests/unit/providers/gemini/adapter.test.ts`

### Redirect handling

- `src/chrome/download-coordinator.ts`
- Redirects are no longer blindly denied when they include a `Location`.
- Redirect target is re-checked against the same asset policy before following.
- Max redirects: `5`.
- Redirects without `Location`, `opaqueredirect`, and redirects outside policy still reject.
- Added tests for:
  - allowlisted redirect
  - redirect without location
  - redirect to disallowed host

### Raster formats and conversion

- `src/chrome/download-coordinator.ts`
- Fetcher now accepts PNG/JPEG/WebP by content type and byte signature.
- `src/offscreen/png-task.ts`
- Offscreen now converts non-PNG raster bytes to PNG via `createImageBitmap` + canvas before enriching metadata.
- Output filename remains `*-ai-prompt.png`.

### Credentials

- `src/chrome/download-coordinator.ts`
- Asset fetch now uses:

```ts
credentials: "include"
redirect: "manual"
```

### Better diagnostics

- `src/shared/contracts.ts`
- `download_failed` now supports optional `status` and `reason`.
- `src/chrome/background.ts`
- Asset fetch failures now map selected low-level errors into `download_failed.reason`, for example `ASSET_REDIRECT_DENIED`.
- `src/content/controller.ts`
- UI now shows the reason rather than only generic `The download could not be completed`.

### CSS injection

- `src/chrome/content.ts`
- Content CSS is imported inline via `../content/content-ui.css?inline`.
- `ensureContentStyles()` injects `<style id="aip2e-content-styles">`.
- Added declaration:
  - `src/vite-env.d.ts`

### Success status behavior

- `src/content/controller.ts`
- On `operation_accepted`, status UI is cleared.
- E2E asserts no `.aip2e-status` remains after a successful Gemini download.

### Gemini blob image support

- `src/providers/gemini/selectors.ts`
- `generatedImage` selector now includes `img[src^='blob:']`.
- `src/providers/gemini/adapter.ts`
- `isGeneratedImage` accepts `blob:` images whose `alt` includes `AI generated`.
- `src/shared/message-types.ts`
- `InitiateOperationMessage` now supports optional `imageBytes?: readonly number[]`.
- `src/shared/message-schemas.ts`
- `imageCandidate.sourceUrl` accepts:
  - `https://...`
  - `blob:https://gemini.google.com/...`
- `src/content/controller.ts`
- For `blob:` image candidates, content-script reads bytes with `fetch(sourceUrl)` and sends `imageBytes` to background.
- `src/chrome/background.ts`
- If `message.imageBytes` exists, background saves those bytes directly and skips network fetch.
- Added fixtures/tests:
  - `tests/fixtures/providers/gemini/blob-image.html`
  - `tests/fixtures/pages/gemini-blob.html`
  - unit tests in `tests/unit/providers/gemini/adapter.test.ts`
  - message schema test in `tests/unit/shared/messages.test.ts`
  - background test in `tests/unit/chrome/background-handler.test.ts`
  - e2e test in `tests/e2e/gemini.spec.ts`

## Verification already run

Passed:

```bash
npm run typecheck
npx vitest run tests/unit/shared/messages.test.ts tests/unit/chrome/background-handler.test.ts tests/unit/providers/gemini/adapter.test.ts
npx vitest run tests/unit/chrome/download-coordinator.test.ts tests/unit/chrome/background-handler.test.ts
npm run build
npm run verify:manifest
npx playwright test tests/e2e/gemini.spec.ts
```

Gemini e2e currently covers:

- full-size href instead of rendered thumbnail
- blob-rendered Gemini image through content-provided bytes

Known build warnings, not blocking:

- Vite externalizes `node:zlib` for browser compatibility from `src/metadata/png-xmp.ts`
- `inlineDynamicImports` warning from Vite/Rolldown

Full `npm run lint` was not clean before this handoff due unrelated existing issues:

- `tests/e2e/fixtures.ts`
- `tests/extension/fixtures-server.ts`
- `tests/fixtures/assets/bad.html`

## Live browser facts gathered

Chrome Gemini tab:

```text
https://gemini.google.com/app/4fac8a7cb501a083
```

DOM probe showed:

```json
{
  "hasStyle": true,
  "extensionButtons": [],
  "modelResponses": 1,
  "userQueries": 1,
  "queryTextCount": 1,
  "downloadControls": [
    {
      "tag": "BUTTON",
      "aria": "Download full size image",
      "href": null,
      "inModel": true
    }
  ],
  "generatedImage": {
    "className": "image animate loaded",
    "src": "blob:https://gemini.google.com/...",
    "alt": ", AI generated",
    "inModel": true
  }
}
```

After implementing blob support, production e2e passes, but user later reported the live page still shows `ASSET_REDIRECT_DENIED`.

## Most likely next debugging steps

1. Reload unpacked extension in `chrome://extensions`.
2. Refresh Gemini tab.
3. Inspect live page again with Playwright:
   - whether `.aip2e-download-button` exists
   - whether candidate `sourceUrl` is `blob:` or `https:`
   - whether `.aip2e-status` reason changed
4. If the live candidate is still `https` and not `blob`, inspect the actual image DOM around the mounted button:
   - `img.currentSrc`
   - `img.src`
   - `img.getAttribute("src")`
   - nearest native download button
   - all image attributes
5. If content-script sees `blob:` but background still receives `https`, check stale extension version/content-script state.
6. If `fetch(blob:)` fails in real content-script, consider using canvas extraction from the `HTMLImageElement` in content-script as a fallback, then sending PNG bytes to background.
7. If Gemini native download button has an internal click path that produces bytes, consider triggering it only as a last resort. Current native button has no `href`, so existing href logic cannot use it.

## Important manual step

The agent could not control `chrome://extensions` because Chrome internal tabs cannot be claimed by the browser-control API. The user must reload the unpacked extension manually after each rebuild.

## Current changed files

At handoff time, the working tree includes modifications across:

- `src/chrome/background.ts`
- `src/chrome/chrome.d.ts`
- `src/chrome/content.ts`
- `src/chrome/download-coordinator.ts`
- `src/chrome/manifest.json`
- `src/content/controller.ts`
- `src/content/image-action.ts`
- `src/offscreen/png-task.ts`
- `src/providers/gemini/adapter.ts`
- `src/providers/gemini/selectors.ts`
- `src/shared/contracts.ts`
- `src/shared/message-schemas.ts`
- `src/shared/message-types.ts`
- tests and fixtures listed above

Untracked new files include:

- `src/vite-env.d.ts`
- `tests/e2e/gemini.spec.ts`
- `tests/fixtures/pages/gemini-blob.html`
- `tests/fixtures/providers/gemini/blob-image.html`
- `tests/fixtures/providers/gemini/full-size-separate-asset.html`
