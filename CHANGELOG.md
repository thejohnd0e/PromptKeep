# Changelog

All notable project changes are documented in this file.

## [1.23] - 2026-09-25

### Fixed

- Updated ChatGPT image scanning for the current gallery and message DOM.
- Restored the ChatGPT `Regenerate image` action through native `Edit` and `Send` controls.
- Fixed ChatGPT blob-image downloads and allowed ChatGPT blob message payloads.
- Added missing `fast-check` and `vitest` development dependencies.

## [1.21] - 2026-09-21

### Added

- Added Gemini quick actions below generated-image downloads:
  - `Try again`
  - `Personalize`
- Added ChatGPT `Edit and resend`, which opens the matching user-message editor
  and submits the unchanged prompt through the native `Send` control.
- Added provider-native action buttons with tooltips, keyboard support, and
  accessible labels.
- Added busy-state protection against repeated quick-action clicks.

### Changed

- Scoped provider actions to the specific response associated with the image.
- Added fail-closed handling when provider controls are missing or ambiguous.
- Documented quick actions and their provider-DOM limitations in `README.md`.

## [1.20] - 2026-09-20

### Changed

- Replaced the extension and image download button artwork.
- Increased the in-page download control to 63 x 63 pixels.
- Enlarged the visible toolbar icon by removing transparent padding.
- Moved the ChatGPT and Gemini controls to avoid overlapping native image
  actions.
- Preserved the one-click 360-degree button animation.

## [1.19] - 2026-09-16

### Changed

- Added provider-prefixed filenames for ChatGPT and Gemini downloads.
- Enlarged the download control to 42 x 42 pixels and added a solid black
  border.

## [1.18] - 2026-09-15

### Changed

- Updated Gemini prompt extraction for the current duplicated accessibility
  markup.
- Prefer the visible Gemini prompt line and avoid duplicating the `You said`
  screen-reader prefix.
- Updated the Gemini selector schema to version 2.

## Initial Implementation

### Added

- Created a local-only Chrome Manifest V3 extension for ChatGPT, Google Gemini,
  and Grok.
- Added provider adapters that pair rendered prompts with generated images and
  fail closed when the association cannot be proven.
- Added safe full-size image download handling, including Gemini's native
  downloader and sandbox message flow.
- Added byte-preserving PNG enrichment without re-encoding image pixels.
- Added XMP/IPTC AI metadata, PNG `parameters`, `Source`, and EXIF fields.
- Preserved unrelated PNG chunks and C2PA `caBX` payloads byte-for-byte.
- Added the extension shell, secure message validation, download coordination,
  offscreen PNG processing, and session operation state.
- Added tests, fixtures, and build output for the Chrome extension.
