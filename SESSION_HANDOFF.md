# Session Handoff

## Current State

- Repository: `AIprompt2exif`, branch `master`.
- Extension version: `1.23`.
- Latest code commit: `0fcca4d` (`fix(chatgpt): restore image actions and blob downloads`).
- Latest documentation commit: `15a5a18` (`docs: record 1.23 release changes`).
- GitHub release: https://github.com/thejohnd0e/AIprompt2exif/releases/tag/v1.23
- Release asset: `AIprompt2exif-v1.23-chrome.zip`.

## ChatGPT Integration

ChatGPT changed its DOM. The current page uses:

- `[data-testid="generated-image-gallery"]` for image galleries;
- `h4[data-conversation-role="assistant"]` for assistant blocks;
- `[data-chatgpt-search-unit-key$=":user"]` for the matching user block;
- `[data-search-result-target]` for rendered prompt text;
- `blob:https://chatgpt.com/...` for generated image URLs.

The adapter supports the current layout and keeps the legacy layout fallback.

`Regenerate image` is an extension action, not a native ChatGPT `Redo` action. It
clicks the matching native `Edit` button, waits for the current
`contenteditable[role="textbox"][aria-label="Edit message"]` editor, and clicks
the native `Send` button without changing the prompt. It intentionally creates
the next image through ChatGPT's normal UI flow.

ChatGPT blob images are read in the content script and passed as `imageBytes`.
The message schema explicitly allows `blob:https://chatgpt.com/...` candidates.

## Validation

Successful checks at the end of the session:

```text
npx vitest run    -> 34 test files, 408 tests passed
npx tsc --noEmit  -> passed
npm run build     -> passed
```

`fast-check` and `vitest` are declared in `devDependencies`; `npm ci` should
install them from `package-lock.json`.

## Release And Deployment

After changing extension code:

1. Update `src/chrome/manifest.json` and the README version badge.
2. Run `npm run build`.
3. Reload the unpacked extension in `chrome://extensions`.
4. Refresh the ChatGPT tab.
5. Run the tests and TypeScript check.
6. Commit and push before creating or updating a GitHub release.

The current release is already published as `v1.23`. A later code change needs
a new version and release rather than mutating the existing asset silently.

## Worktree Note

`PLAN.md` is an untracked, separate PromptLens planning document. It is not the
handoff for this Chrome extension and should not be committed accidentally.
