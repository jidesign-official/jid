# Administrator design direction

## Scope

The user-supplied **Apple — Style Reference** applies to `/admin/` and its upload-manual dialog only. Keep the public website's layout, theme toggle, typography and original assets unchanged. This is an editor interface, not a replica of an Apple product launch page: omit pricing, preorder copy and unrelated product imagery.

## Palette and surfaces

- Gallery canvas and cards: `#ffffff`.
- Editor feature stage and subdued fills: `#f5f5f7`; secondary navigation fill: `#fafafc`.
- Primary text: `#1d1d1f`; secondary text: `#707070`.
- Hairlines: `#d6d6d6`; control outlines: `#86868b`.
- Text links and keyboard focus: `#0066cc`.
- Compact primary actions: `#0071e3` with white text and fully rounded ends.
- Cards, preview surfaces and contained media: **28px radius**, including mobile; no cast shadows or gradients.
- The supplied reference is intentionally **light**. Scope that choice to the administrator shell and modal even when the public site or OS is dark.

## Type and layout

Use locally available SF Pro/system faces and the existing Korean fallback; do not fetch or redistribute proprietary Apple fonts. Desktop display headings use 80px/600 with restrained negative tracking. Scale down on narrow screens rather than allowing overflow. Keep working copy readable, inputs at least 16px and touch targets at least 44px. Use generous whitespace and flat white editing surfaces over a mist-gray stage, without making the interface resemble a dense boxed dashboard.

## Brand

Reuse the exact public-site `public/logo.png` through `getAssetPath('/logo.png')`. The source is 100 × 51px: preserve its aspect ratio with `object-fit: contain`, retain the `JiD` alternative text and existing homepage link. Do not recreate the logo as text, crop it, recolor it or modify the original file.

## Behavior and security boundaries

Styling does not change package validation, model limits, ZIP bytes/naming, draft persistence, catalog contents, public rendering, upload instructions or permissions. Retain the keyboard-operable native dialog and internal mobile scrolling.

The user explicitly chose to retain the current public GitHub Pages editor for this refresh. No login gate, authentication server or local-only conversion is part of this change. A client-side GitHub-login flag, hidden URL or `noindex` is not access control. Native GitHub repository authorization continues to govern publishing. Do not describe this visual refresh as a login/security implementation.
