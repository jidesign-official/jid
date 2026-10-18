# About content editor contract (v1)

## Scope and publication

Add an **About Us 편집** tab to the existing public administrator. Keep GitHub-only publication, the exact obscure editor route/noindex, the existing Apple-style editor, project ZIPs and portfolio settings unchanged. Edit text/structured lists, not HTML, layout, CSS, images or arbitrary URLs. No new authentication service or frontend credentials.

The browser imports/exports **about-content.json**. Upload/replace this file at repository root and commit; it is neither a project ZIP nor portfolio-settings.json. Download/import/local edits are not publication. Same-commit build validation must fail closed for invalid present content. Keep original src/data/about.ts and ABOUT US.docx immutable as the default/original reference. Initial deployed copy, structure, styling, links, metadata and original 54 business strings remain unchanged.

## Client-safe API and JSON

`src/lib/aboutContent.ts` exports:

```ts
export type AboutContent = {
  schemaVersion: 1;
  headings: { eyebrow: string; philosophy: string; history: string; services: string };
  introduction: { title: string; subtitle: string; paragraph: string };
  philosophy: { id: string; title: string; subtitle: string; paragraph: string }[];
  history: { year: string; events: string[] }[];
  services: { name: string; description: string }[];
  links: { portfolioLabel: string; contactLabel: string };
};
export const ABOUT_CONTENT_FILENAME = "about-content.json";
export const MAX_ABOUT_CONTENT_BYTES = 64 * 1024;
export function createDefaultAboutContent(): AboutContent;
export function validateAboutContent(value: unknown): asserts value is AboutContent;
export function parseAboutContent(source: string): AboutContent;
export function serializeAboutContent(value: AboutContent): string;
```

- Client-safe: no Node/fs import. Default builder copies the unchanged src/data/about.ts and existing literal headings/link labels from the original About page; return fresh arrays/objects, never mutate originals.
- Exactly the declared fields at every object level; no unknown or missing keys; numeric schemaVersion1. Reject duplicate keys including escaped aliases at every object level. Bound lexical nesting to8 and UTF-8 input/export to64KiB before parse/amplification. Reject malformed JSON and non-JSON objects/types.
- All text strings must contain non-whitespace; preserve exact supplied text, punctuation and whitespace (no trimming/normalization of accepted values). Permit newline/tab but reject other C0 controls and DEL. No rich HTML interpretation: React escapes strings; literal markup is inert text, not rejected merely for containing angle brackets. Never render through dangerouslySetInnerHTML.
- headings/link labels max120 UTF-16 code units; title max240, subtitle max500, paragraph max6000. Service name max240/description max2000, event max1000. Total encoded file64KiB remains an independent bound.
- Philosophy0..12, history0..100, services0..30. Empty arrays intentionally omit the corresponding public section. Intro fields remain required. History events1..30 per year. Philosophy IDs unique exact ASCII `^[a-z][a-z0-9-]{0,63}$`, excluding reserved DOM IDs about-introduction/about-philosophy/about-history/about-services. IDs are internal, not editable text controls; preserve existing three IDs, generate new stable safe IDs in the editor.
- History year unique exact ASCII four digits1000..9999; no coercion or sorting. Preserve user list order. Service names unique to preserve identity. Event duplicates may remain; render events with positional keys, not duplicate text keys.
- Serializer validates and emits JSON.stringify(value,null,2)+newline. Parser returns cloned validated data. UI may temporarily contain invalid/blank new entries, but export must clearly block until valid. Korean actionable errors and failed import preserve the current draft.

## Server and public page

`src/lib/aboutContentServer.ts` exports `getAboutContent(root = process.cwd()): AboutContent`. Read only root/about-content.json. Only absent initial ENOENT uses original defaults; invalid/unreadable/nonregular/symlink/oversized or racing file fails. Use bounded actual read64KiB+sentinel and fatal UTF-8 decoding, as in the existing portfolio resolver. No CMS registry dependency.

Commit an initial root about-content.json exactly representing current content. Public src/app/about/page.tsx uses getAboutContent for body and prerendered metadata. Keep title `About Us - JiD`, description bound to current introduction.paragraph. Use generateMetadata or equivalent valid server API; no client-side loading of public copy. Preserve semantic article label About JiD, stable section DOM IDs, existing layout/classes, bilingual lang attributes, navigation label Explore JiD and fixed /portfolio and /contact URLs. Permit only a scoped inherited overflow-wrap rule needed for valid edited long unbroken text; preserve the default HTML oracle except that explicit wrapping token and retain all original default geometry/copy checks. Verify valid maximum-length subtitles, paragraphs, events, descriptions and CTA labels at320px through actual exported JSON, not only ordinary default copy. Only labels/content change; no arbitrary link editing. Extract a component only if necessary, with exact default output preserved.

## About editor

`src/components/admin/AboutEditor.tsx` receives `{ initialContent: AboutContent; onDirtyChange: (dirty:boolean)=>void }`, with AboutEditor.module.css. Parent wires server prop `initialAboutContent`, navigation tab key `about`, and independent `aboutDirty` into existing combined header/beforeunload boundary. Mount under `hidden={tab !== "about"}` so edits survive all tab switches. Do not interfere with ZIP drafts or portfolio catalog state.

- Heading **About Us 편집.**; editable headings, introduction, CTA labels and all philosophy/history/services text. Add/delete-confirm/reorder philosophy/history/services and per-year events via44px arrow buttons. Internal IDs not changed when editing titles/moving rows. Initial content is current published props, not always original defaults.
- Optional local **텍스트 미리보기** uses safe React text and scoped light styling, explicitly not an exact public-layout preview. Link **현재 게시된 About 보기** opens /about/ as published, not a draft preview. No iframe srcDoc or HTML injection needed.
- Guard64KiB import before file.text(), lock immediately with busy ref, guard mounted/epochs, preserve current draft for invalid files, confirm replacing dirty edits, allow reselecting same file. Reset to published props with confirmation.
- Exact export filename about-content.json; disabled while invalid/busy; canonical bytes; cleanup/revoke download URLs. Download remains dirty/unpublished. Visible validation and polite status/error messages. No automatic server writes or claiming deployment status.
- Explicit repository-root upload and Actions links; distinguish About JSON, portfolio-settings.json and project ZIP destinations. Warn about refresh losing this tab's unsaved local edits. Preserve current logo; no footer tag in manager/editor because strict existing no-site-footer boundary remains. Scope CSS above parent shell input/button/label specificity. White/mist/Ink/blue flat28px,16px inputs,44px controls,320px no overflow, readable with actual html.dark.

## Tests and ownership

Backend owner: new aboutContent.ts/aboutContentServer.ts/root about-content.json and tests/about_content/{content.spec.ts,content.config.ts}. TDD vertical slices, use deferred typed createRequire under real Node20 as well as local Node26. Defaults tests isolated, not assertions that mutable checked-out content equals originals; actual checkout test validates any legitimate current content. Parent owns npm/workflow gate wiring and actual pipeline integration.

UI owner: AboutEditor.tsx/AboutEditor.module.css and tests/e2e/about-editor.spec.ts. Actual baseline RED against current static port3002 before implementation; parent owns rebuild/GREEN. Use helpers/admin-route, real hydrated navigation, current independent copy fixtures; do not edit parent integration or public page. No source/build/server/GPU/stage/commit/push outside ownership.

Public owner: src/app/about/page.tsx and NEW tests/e2e/about-content-public.spec.ts (Node-only real-source VM/temporary-root service tests). TDD for new dependency, custom content and metadata, empty-section omission, safe text, order preservation. Existing tests/e2e/about.spec.ts remain unchanged as independent original54/default design oracle. Coordinate server module existence; do not weaken baseline tests or modify originals.

Parent: administrator wiring, docs/MEMORY.md, package/workflow/pipeline tests, builds/browser execution, independent review, release. Back up/protect original492 ledger and jdesign.xlsx remains excluded. Require actual browser JSON export -> real npm gate/build -> custom public HTML/metadata/order -> exact original settings restoration/rebuild. Prove invalid content blocks build and default54/noJS/layout semantics survive. Review exact frozen scope, full regression then serial representative GPU, exact-commit CI/live; never publish QA copy.
