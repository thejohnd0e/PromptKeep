# AI Prompt Image Metadata Design System

## 1. Atmosphere & Identity

A quiet browser-native utility layer that feels like part of the page without imitating the provider. The signature is compact monochrome controls: white surfaces, black text, crisp edges, and only enough shadow to separate injected UI from unpredictable page content. Status notifications should feel like a small modern product toast, not a browser/system dialog.

## 2. Color

| Role | Token | Light | Usage |
|------|-------|-------|-------|
| Surface/primary | --aip2e-surface-primary | #FFFFFF | Toasts, dialogs, injected controls |
| Surface/secondary | --aip2e-surface-secondary | #F9F9F8 | Prompt preview surfaces |
| Text/primary | --aip2e-text-primary | #111111 | Primary toast and dialog text |
| Text/secondary | --aip2e-text-secondary | #5F6368 | Codes, labels, secondary details |
| Border/subtle | --aip2e-border-subtle | rgba(0, 0, 0, 0.08) | Toast border |
| Border/default | --aip2e-border-default | #EAEAEA | Dialog and field borders |
| Accent/info | --aip2e-accent-info | #111111 | Default status marker |
| Accent/success | --aip2e-accent-success | #346538 | Success marker |
| Accent/warning | --aip2e-accent-warning | #956400 | Warning marker |
| Accent/error | --aip2e-accent-error | #9F2F2D | Error marker |

Rules:
- Toast surfaces remain white with black primary text for every status level.
- Status color is a small dot marker only, never a full colored fill or a heavy side bar.

## 3. Typography

| Level | Size | Weight | Line Height | Tracking | Usage |
|-------|------|--------|-------------|----------|-------|
| Body/sm | 13px | 500 | 1.45 | 0 | Toast messages |
| Caption | 11px | 600 | 1.3 | 0.04em | Compact labels when visible |

Font stack:
- Primary: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
- Mono: ui-monospace, "SFMono-Regular", Consolas, monospace

Rules:
- Toast text must stay compact and readable over third-party pages.
- Status codes are visually hidden in toasts so end-user messages stay non-technical.

## 4. Spacing & Layout

Base unit: 4px.

| Token | Value | Usage |
|-------|-------|-------|
| --aip2e-space-1 | 4px | Tight internal gaps |
| --aip2e-space-2 | 8px | Compact offsets |
| --aip2e-space-3 | 12px | Horizontal toast padding |
| --aip2e-space-4 | 16px | Viewport inset |

Rules:
- Toast max width is compact and constrained by viewport width.
- Fixed browser-overlay elements use stable dimensions and do not shift provider layout.

## 5. Components

### Status Toast
- Structure: fixed-position container with a small status dot, visually hidden status code, and message text.
- Variants: info, success, warning, error.
- Spacing: --aip2e-space-2 vertical padding, --aip2e-space-3 horizontal padding, --aip2e-space-4 viewport inset.
- States: default per status variant; error uses `role="alert"`, all other variants use `role="status"`.
- Accessibility: text remains real DOM text, black on white, with semantic status roles.
- Motion: no decorative motion; toast appears at its fixed position.
- Layout: fixed overlay, bottom-right, compact border-box max width, 8px radius.

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Micro | 120ms | ease-out | Button press |
| Standard | 200ms | ease-in-out | Hover or state shifts |

Rules:
- Animate only `transform` and `opacity`.
- Respect `prefers-reduced-motion` for non-essential motion.

## 7. Depth & Surface

Strategy: mixed.

| Level | Value | Usage |
|-------|-------|-------|
| Toast | 0 12px 28px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04) | Overlay separation from arbitrary pages |

Rules:
- Toasts use a white surface, subtle border, and soft shadow.
- Dialogs may keep stronger elevation because they intentionally interrupt flow.

## 8. Accessibility Constraints & Accepted Debt

Constraints:
- WCAG 2.2 AA contrast for body text.
- Status text must be selectable real text and safely assigned with `textContent`.
- Error notifications keep alert semantics.

Accepted debt:
- None.
