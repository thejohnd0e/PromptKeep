# PromptKeep

_Never lose the prompt behind an image_

[![Version](https://img.shields.io/badge/version-1.27-2E7D32)](https://github.com/thejohnd0e/PromptKeep/releases/tag/v1.27)
[![License](https://img.shields.io/badge/license-MIT-blue?label=license)](./LICENSE)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![Privacy](https://img.shields.io/badge/privacy-local--only-2E7D32)](#privacy)

A local-only Chrome extension that saves AI-generated images **together with the prompt
that produced them**. It adds a small download control to generated images on ChatGPT,
Google Gemini, and Grok, then embeds the prompt as standard IPTC AI metadata in the
downloaded PNG.

No backend, no accounts, no telemetry — the prompt never leaves your machine.

---

## What it does

1. Detects generated images on supported provider pages and overlays a round white **P**
   button (visible on hover, top-right corner of the image).
2. On click it downloads the full-size PNG, embeds the prompt metadata, and saves it with
   a provider-prefixed unique name (e.g. `ChatGPT-<unique-id>-ai-prompt.png` for ChatGPT,
   `Gemini-<unique-id>-ai-prompt.png` for Gemini, and
   `Grok_imagine_<unique-id>-ai-prompt.png` for Grok Imagine.
3. Leaves the pixels untouched and copies every unrelated PNG chunk byte-for-byte,
   including the original CRCs and any `caBX` (C2PA) payload.
4. Adds quick actions below the download button for generated images:
   - **Google Gemini** — `Try again` and `Personalize`, delegated to Gemini's native
     controls for the matching response.
    - **ChatGPT** — `Regenerate image`, which opens the matching user message editor and
      submits the unchanged prompt through ChatGPT's native `Send` control.

The quick actions are scoped to the specific response containing the image. They fail
closed when the provider's current DOM does not expose an unambiguous native control;
the extension never calls private provider APIs for these actions.

## Metadata written

| Location | Field | Value |
| --- | --- | --- |
| XMP (`iTXt`) | `Iptc4xmpExt:AIPromptInformation` | the original user prompt |
| XMP (`iTXt`) | `Iptc4xmpExt:AISystemUsed` | `ChatGPT`, `Google Gemini`, or `Grok` |
| XMP (`iTXt`) | `Iptc4xmpExt:AISystemVersionUsed` | observed model version, when visible |
| XMP (`iTXt`) | `Iptc4xmpExt:DigitalSourceType` | `http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia` |
| PNG text (`iTXt`, UTF-8) | `parameters` | the prompt under the Stable Diffusion-compatible keyword |
| PNG text (`tEXt`) | `Source` | the full page URL of the conversation |
| `eXIf` | `ImageDescription`, `Software`, `UserComment`, `XPComment` | prompt and system label |
| `caBX` | — | preserved byte-for-byte; never altered or removed |

`parameters` is written as UTF-8 `iTXt`, so non-Latin-1 prompts (Cyrillic, CJK, emoji)
survive exactly. No Latin-1 `tEXt` copy is emitted, because it would turn the same prompt
into mojibake.

The `eXIf` block is skipped when the source PNG contains a `caBX` chunk. ExifTool has a
known bug ([exiftool/exiftool#452](https://github.com/exiftool/exiftool/issues/452)) that
makes it mis-parse a PNG containing both chunks, so the extension avoids the collision.
The prompt remains fully available through XMP and `parameters`.

## Reading the prompt back

- **ExifTool** / **ExifToolGUI** — shows `PNG:Parameters`, `PNG:Source`, and
  `XMP-iptcExt:AIPromptInformation`.

## Installation

### Chrome extension

```bash
npm ci
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and
select the generated `dist/chrome` directory.

## Requirements

- Node.js >= 22.12.0 and npm >= 10.9.2 (development only)
- Google Chrome (Manifest V3)

## Architecture

Three isolated layers keep volatile provider integrations away from the byte-level writer:

- **Provider adapters** (`src/providers/`) — versioned DOM selectors for ChatGPT, Gemini,
  and Grok Imagine. Each adapter pairs a rendered prompt with generated images and fails
  closed when identity cannot be proven.
- **Extension shell** (`src/chrome/`, `src/offscreen/`) — a Manifest V3 service worker
  validates sender origin and message schemas, fetches the asset through an allow-list,
  and hands the bytes to an offscreen document.
- **Metadata core** (`src/metadata/`) — a bounded, byte-preserving PNG chunk writer. It
  validates every chunk CRC, inserts the new chunks before the first `IDAT`, and never
  decodes or re-encodes image data through Canvas.

## Limitations

- **Chrome only.** Manifest V3; no Firefox, Safari, or mobile builds.
- **PNG only.** JPEG, WebP, AVIF, and animated formats are out of scope.
- **Fixtures, not live provider contracts.** ChatGPT, Gemini, and Grok change their DOM
  without notice. When a layout changes, the affected adapter fails closed and no file is
  produced until its versioned selectors are refreshed.
- **Quick actions depend on provider UI.** Regeneration, personalization, and edit/resend
  are performed by clicking the provider's visible native controls. A provider layout or
  localization change can temporarily disable an action until its selectors are refreshed.
- **`parameters` is `iTXt`.** Tooling that scans only `tEXt`/`zTXt` will not see it. This
  is a deliberate trade-off in favour of correct non-Latin-1 prompts; XMP remains the
  standards-compliant channel.
- **C2PA is preserved, not re-signed.** When a source PNG contains `caBX`, the extension
  keeps it byte-for-byte, but the embedded signature no longer verifies for the modified
  file. No validity is ever claimed.
- **EXIF ASCII fields transliterate.** `ImageDescription`/`Software` are ASCII; non-ASCII
  characters become `?`. The full prompt lives in the UTF-8 XMP and `parameters` fields.

## Privacy

Everything runs locally in the browser. The extension:

- ships no remote code, uses no analytics, and sends no prompt anywhere;
- requests only `storage`, `downloads`, and `offscreen`, plus the exact provider hosts;
- keeps operation state in `chrome.storage.session` and deletes it after completion;
- never uploads, logs, or persists the raw prompt beyond the download itself.

## License

[MIT](./LICENSE)
