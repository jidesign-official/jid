# Portfolio management settings (v1)

## Scope and publication

The existing public browser editor gains catalog ordering, reversible publication exclusion, and selection/order of exactly four homepage projects. This applies to existing legacy projects and CMS additions without rewriting original metadata, images, GLBs, workbooks or project ZIPs. Exclusion removes a project from public lists, static detail routes, previous/next links and homepage eligibility; it does not make retained source/media private. There is no physical file deletion or new authentication service.

Download **portfolio-settings.json**, then upload/replace that one file at the GitHub repository root and commit to main. The same source commit is validated and built by the read-only-contents Actions workflow. Local edits, file import and download do not publish. Project ZIP uploads remain in admin-submissions and are a separate workflow. A bad settings file fails the build; it must never silently reset the live settings.

## Exact JSON format

```json
{
  "schemaVersion": 1,
  "order": [],
  "hidden": [],
  "featured": ["jd025_c", "jd008_b", "jd005_b", "jd013"]
}
```

- Exactly these four root keys are required; no extra keys. Reject duplicate root keys, including escaped aliases, before accepting parsed data.
- schemaVersion is the number 1, never coerced.
- IDs are ASCII strings matching `^jd[0-9]{3}(?:_[a-z]+)?$`, at most80 characters. No trimming, case normalization or coercion. IDs must exist in the complete current catalog, including hidden projects.
- Each list is an array of unique IDs. `order` and `hidden` are bounded to1000 entries; the current catalog is bounded to1000 unique valid IDs. Input/export UTF-8 is bounded to64KiB before parsing/read amplification.
- `order` may be a subset: explicit IDs are first, and omitted IDs append in the existing automatic catalog order (jd038 pinned, model-count descending, model bytes ascending, stable ties). Exclusion is independent of ordering and retains each item's stored position. Normalization expands `order` to every current ID exactly once.
- `featured` contains **exactly four distinct, existing, non-hidden IDs**, in homepage display order. Images-only/no-GLB projects are eligible. Never silently pick replacements, drop an invalid featured item or accept fewer than four at publication.
- Missing settings file uses these current four homepage IDs and current automatic ordering. Present-but-invalid, unreadable, non-file/symlink or oversized inputs fail closed. A committed initial file uses the example above, so the default site/order/selection do not change.
- Physically removing a CMS ZIP whose ID remains in settings requires updating its references in this settings file too. The recommended UI operation is reversible exclusion, not deleting ZIP/media files.

## Shared client-safe API: src/lib/portfolioSettings.ts

No fs, Node-only imports, credentials, URLs, HTML or binary assets.

```ts
export type PortfolioSettings = { schemaVersion: 1; order: string[]; hidden: string[]; featured: string[] };
export const PORTFOLIO_SETTINGS_FILENAME = "portfolio-settings.json";
export const MAX_PORTFOLIO_SETTINGS_BYTES = 64 * 1024;
export const DEFAULT_FEATURED_IDS = ["jd025_c", "jd008_b", "jd005_b", "jd013"];
export function createDefaultPortfolioSettings(projectIds: readonly string[]): PortfolioSettings;
export function validatePortfolioSettings(value: unknown, projectIds: readonly string[]): asserts value is PortfolioSettings;
export function normalizePortfolioSettings(value: PortfolioSettings, baselineIds: readonly string[]): PortfolioSettings;
export function parsePortfolioSettings(source: string, projectIds: readonly string[]): PortfolioSettings;
export function serializePortfolioSettings(value: PortfolioSettings, projectIds: readonly string[]): string;
```

Use actionable Korean errors. Normalization validates and clones arrays; no mutation of input/default constants. Parsing and export both enforce the same contract. Draft editing may temporarily have fewer than four featured IDs, but export is disabled until valid.

## Server-only API: src/lib/portfolioManagement.ts

```ts
export function getPortfolioManagement(root = process.cwd()): {
  allProjects: PortfolioCatalogProject[];
  settings: PortfolioSettings;
  projects: PortfolioCatalogProject[];
  featuredProjects: PortfolioCatalogProject[];
};
```

- `allProjects`: complete catalog, including hidden entries, in **baseline automatic order**. This is the administrator metadata source and normalization fallback.
- `settings`: validated normalized settings, with full `order`.
- `projects`: visible catalog in manual order; use consistently for public pagination, static params, metadata and previous/next links.
- `featuredProjects`: the four resolved visible entries in `featured` order, with no GLB eligibility requirement.
- Read only root/portfolio-settings.json. Existing getPortfolioCatalog remains the raw catalog. Existing sortPortfolioProjects remains the baseline algorithm; add optional `root` if needed to pass it consistently to model resolution/stat paths for isolated tests.

## Administrator component: src/components/admin/PortfolioManager.tsx

```tsx
<PortfolioManager
  projects={management.allProjects}
  initialSettings={management.settings}
  onDirtyChange={setCatalogDirty}
/>
```

Parent integration owns AdminWorkspace and the hidden editor route. The manager stays mounted inside a `hidden` container while other admin tabs are active, preserving local edits. Parent beforeunload/local-state includes catalogDirty; do not interfere with editor package draft state.

- Retain heading **프로젝트 목록.** for existing navigation/readiness behavior. Clear UI sections for 메인 대표 항목 and 전체 포트폴리오. Current four are visibly selected initially in their current order.
- Full catalog rows show thumbnail/title/ID/status, featured checkbox, up/down and desktop drag controls, 게시 제외/복원. Mobile/keyboard controls must be >=44px; no drag-only interaction.
- Use order IDs to render rows, not the array order of props. Search/filter must not ambiguously reorder invisible rows: disable global moves while filtered and explain how to return to the full list.
- Feature checkboxes allow deselect/reselect; at four, disable adding another until one is deselected. Show selected cards with up/down controls to reorder homepage slots independently from catalog ordering. Excluded entries cannot be featured.
- Confirm exclusion. If featured, explicitly warn it will be deselected and another choice is required before export. Confirmation cancellation leaves all state unchanged. Restore keeps the existing order position.
- Import bounded JSON using the shared parser and normalization against baseline props IDs. Corrupt/incompatible imports preserve the current draft; allow re-importing another correct file. Prompt before replacing unsaved edits. Async imports need busy/mounted guards.
- Export the validated settings file with exact filename, canonical JSON and no titles/media. Provide GitHub root upload and Actions links, explicitly explaining download != publication. Reset to currently published props with confirmation; do not silently reset to original defaults.
- Keep public/offline and repository-wide write disclaimers. This does not grant publish rights. No tokens/password inputs, backend API writes, or additional dependencies.
- Preserve scoped Apple-style white/mist/Ink/blue flat28px surfaces, current logo and native upload manual.

## Verification acceptance

1. Baseline current four, all existing IDs/titles/routes/media/order and data bytes unchanged with initial settings.
2. Shared parser/server tests: limits, duplicate/escaped keys, wrong fields/types/IDs, duplicates, hidden-feature conflicts, exactly four, input immutability, raw/normalized order, missing/invalid/oversized/symlink inputs and no-GLB selections.
3. Browser tests: all four initially selected, reorder both lists, filtered movement behavior, exclusion confirmation/cancel/restore, export blocker until replacement, import/export byte/shape compatibility, state retained across tabs, dirty warning, keyboard/mobile/contrast, invalid import recovery and GitHub links without external writes.
4. Actual exported JSON is applied in a local static build: edited list/home order, hidden route404, no hidden previous/next links and image-only featured item work. Restore the exact initial settings and rebuild before freeze/review/final regression/publication. Never publish QA exclusions or selections.
5. Update hand-rolled VM dependency dispatchers and semantic home-region/link tests to the real management helper and generic representative-project labels without weakening independent title/order/asset/route/no-home-GLB checks.
6. Existing opaque editor URL/noindex/old-admin404, ZIP/GLB validation and drafts remain unchanged. Independent review, exact snapshot regression and exact-commit CI/live verification remain required.

The npm `pretest:portfolio-settings` lifecycle imports the current checkout's submitted ZIPs before the settings gate resolves its catalog. Default-value tests use isolated roots; the checked-out settings are validated against the current complete catalog, never required to remain the initial values. Pipeline regressions exercise the same npm gate with a captured nondefault browser export, a normalized unchanged export, a fresh CMS ZIP selected on the homepage, and invalid ZIP/settings rejection. This ordering is required on clean Actions checkouts, where generated registry/media are intentionally not committed.
