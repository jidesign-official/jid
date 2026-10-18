# About editor ↔ HTML source (synchronized view)

## User decision and scope

The user selected **에디터 ↔ HTML 소스 전환: 같은 내용을 두 방식으로 편집하고 서로 반영**. This is a second editing representation of the existing structured AboutContent, not two independent saved documents. Preserve current published About copy, defaults, public layout, metadata, JSON schema and publication flow.

The HTML source represents the existing introduction/philosophy/history/services/CTA structure. It supports changing field text and list items/order within that structure. Explain that the `data-about-*` markers and section/field structure connect to the editor. Do not claim arbitrary page HTML, styling or inline rich formatting: unsupported tags/attributes/structures produce an actionable error rather than being stripped or ignored. No scripts, event handlers, CSS, media, foreign namespaces, arbitrary links, iframe or HTML injection. JSON text containing literal markup still remains literal text via entity escaping.

Publication stays **about-content.json → GitHub repository root → commit → same-commit validation/build/deploy**. Do not persist a second HTML file or change AboutContent v1. Public server rendering continues escaped React text; raw HTML never reaches dangerouslySetInnerHTML, iframe srcDoc or DOMParser/innerHTML previews.

## Shared client-safe adapter

`src/lib/aboutHtml.ts` exports:

```ts
export const MAX_ABOUT_HTML_BYTES = 512 * 1024;
export function aboutContentToHtml(content: AboutContent): string;
export function aboutHtmlToContent(source: string): AboutContent;
```

Use exact installed **parse5 7.3.0**, pinned in package/lock by parent (supports CommonJS Node20 and browser bundles). Do not implement an HTML parser with regex. No Node/fs/browser globals in adapter. Reuse validateAboutContent for returned models; JSON/export64KiB remains independent from the HTML representation's512KiB bound (entities and structural markup expand valid JSON).

Bound source UTF-16 length before UTF-8 encoding, then UTF-8 bytes before tokenization. Use parse5 Tokenizer preflight to reject unsupported tags, comments/doctypes, self-closing tags, duplicate attributes/parser errors, unmatched/unclosed tags, depth>16 and >6000 start tags **before** building a full AST. Pinned package exports Tokenizer/TokenHandler; inspect installed d.ts. Then parseFragment with parse errors rejected and validate exact tree structure/attributes/namespaces. Bound full AST nodes to12000. No silent HTML5 repair: require explicit matching closing tags and expected canonical DOM shape. A tokenized AST mismatch must fail, not discard content.

Retain field text literally after HTML entity decoding, including leading/trailing spaces, LF and tabs. Ignore whitespace-only text only BETWEEN structural elements, never inside text fields. Text fields contain text nodes only; inline elements are unsupported, not stripped. Preserve list order and IDs, do not sort, trim or normalize accepted model values. Standard HTML source casing/entity/indentation/CRLF normalization may canonicalize representation; never silently alter model content. If a model cannot be represented losslessly (for example problematic Unicode), report it and leave the structured draft intact rather than coercing characters.

Canonical serializer emits the grammar below with2-space structural indentation and a trailing newline. Escape text/entity/attribute values safely. It validates input, preserves all values/order/IDs, checks representation limits and returns no source that cannot safely round-trip. Empty lists remain empty wrappers in source so section labels survive; public renderer still omits empty sections. Return fresh validated AboutContent objects, never mutate input/defaults.

## Exact source grammar

Root and four sections, fields and fixed links occur exactly in this order. Attributes are exactly those shown; no extra class/style/event/URL attributes. Field contents below are placeholders for escaped text, not literal defaults.

```html
<article data-about-document="1">
  <section data-about-section="introduction">
    <p data-about-field="eyebrow">About Us</p>
    <h1 data-about-field="title">Introduction title</h1>
    <p data-about-field="subtitle">Introduction subtitle</p>
    <p data-about-field="paragraph">Introduction paragraph</p>
    <nav>
      <a data-about-field="portfolioLabel" href="/portfolio">View Portfolio</a>
      <a data-about-field="contactLabel" href="/contact">Start a Project</a>
    </nav>
  </section>
  <section data-about-section="philosophy">
    <h2>Design Philosophy</h2>
    <section data-about-id="stable-id">
      <h3>Philosophy title</h3>
      <p data-about-field="subtitle">Philosophy subtitle</p>
      <p data-about-field="paragraph">Philosophy paragraph</p>
    </section>
  </section>
  <section data-about-section="history">
    <h2>Company History</h2>
    <ol>
      <li>
        <time>2018</time>
        <ul>
          <li>Event text</li>
        </ul>
      </li>
    </ol>
  </section>
  <section data-about-section="services">
    <h2>Our Services</h2>
    <dl>
      <div>
        <dt>Service name</dt>
        <dd>Service description</dd>
      </div>
    </dl>
  </section>
</article>
```

Philosophy inner sections, history ol/li year records, each year's ul/li events, and services dl/div records repeat according to existing JSON limits. Zero philosophy/year/service records are supported. Year events require1..30. IDs/years/names remain governed by existing strict AboutContent validator. Fixed href values are exactly /portfolio and /contact; they are not stored or user-configurable.

## UI integration

Keep existing AboutEditor and all current fields/list controls; default mode **에디터**. Add accessible **에디터 / HTML** mode tabs inside AboutEditor (not global administrator navigation), a large readable monospace textarea labeled **About HTML 소스**, and clear compatibility/marker/unsupported-HTML help.

- Editor→HTML generates source from current draft only; invalid incomplete structured entries block switching with clear validation and preserve the draft.
- HTML→editor parses and validates the source before replacing fields. Invalid input keeps HTML mode, raw source, prior valid structured content and unsaved warning; no silent sanitization/drop/reset.
- HTML edits must be represented on export: valid source exports matching canonical about-content.json, invalid source disables export. Export does not mark published/clean. Mode switching canonicalizes representation but preserves content.
- Pending raw HTML participates in dirty callback/header/beforeunload even if no valid model has yet been applied. Preserve it across global administrator tabs. Reset to published props clears both representations only after confirmation and must not clear project/catalog dirty state.
- JSON import remains guarded/bounded/busy/mounted/epoch safe; a pending raw HTML edit also triggers replacement confirmation. Successful import updates both representations consistently; cancelled/invalid import preserves both. All controls lock during async import.
- Parent AboutEditor remains mounted. Mode panels may conditionally mount because their state is retained in AboutEditor; avoid hidden source textarea affecting existing tests that measure every rendered field. Do not leave fields from both representations simultaneously active.
- Keep original logo, original public54 strings, Apple light UI under actual html.dark,16px input fonts/44px targets/320px no overflow. No footer. No new media or public styles. Keep all existing AboutEditor5 and original About tests intact.

## Ownership and verification

Adapter owner: new aboutHtml.ts and tests/about_html/{html.spec.ts,html.config.ts}. Strict vertical TDD; native Node20 and26. Test exact full round-trip of defaults/edited lists/entities/whitespace/markup-as-text/empty lists/max valid payload, safe canonical output, malformed/unsafe/unknown nodes/attributes/links/duplicate attrs/depth/token/node/byte limits, input immutability and client safety. Do not edit existing AboutContent validator/server or public renderer.

UI owner: AboutEditor.tsx/AboutEditor.module.css/new tests/e2e/about-html.spec.ts only. Actual current static :3002 baseline RED lacks mode UI; parent owns builds/GREEN. Cover both conversion directions, invalid source preservation/blockers, export from HTML without stale data, import/cancel/reset with pending source, global-tab persistence/dirty isolation, local-only requests, unsafe input inertness and responsive/light-dark controls. Save/attach actual HTML-edited JSON download for parent gate/build proof. No Node/browser/GPU concurrent with parent unless coordinated; no build/server/stage/commit/push.

Parent owns package/lock, npm/workflow gates, docs/manual/MEMORY, backup493, whole acceptance/review/release. Current baseline commit9b02526 and root about-content.json/portfolio-settings.json/original source/media/Word/workbook preserved. Actual HTML-edited browser export→real npm gate/build→public copy/metadata/order/safety, then exact default restoration. Independent frozen review, whole regression, serial representative GPU, exact-commit CI/live. Never publish QA text or imply HTML view grants publication/authentication.
