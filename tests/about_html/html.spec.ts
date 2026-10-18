import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(__dirname, "../..");
const load = createRequire(__filename);
type Adapter = typeof import("../../src/lib/aboutHtml");
type ContentApi = typeof import("../../src/lib/aboutContent");
const content: ContentApi = load("../../src/lib/aboutContent");
function adapter(): Adapter {
  expect(fs.existsSync(path.join(root, "src/lib/aboutHtml.ts")), "client-safe HTML adapter exists").toBe(true);
  return load("../../src/lib/aboutHtml") as Adapter;
}

const emptyHtml = `<article data-about-document="1">
  <section data-about-section="introduction">
    <p data-about-field="eyebrow">About Us</p>
    <h1 data-about-field="title">Title</h1>
    <p data-about-field="subtitle">Subtitle</p>
    <p data-about-field="paragraph">Paragraph</p>
    <nav>
      <a data-about-field="portfolioLabel" href="/portfolio">View Portfolio</a>
      <a data-about-field="contactLabel" href="/contact">Start a Project</a>
    </nav>
  </section>
  <section data-about-section="philosophy">
    <h2>Design Philosophy</h2>
  </section>
  <section data-about-section="history">
    <h2>Company History</h2>
    <ol>
    </ol>
  </section>
  <section data-about-section="services">
    <h2>Our Services</h2>
    <dl>
    </dl>
  </section>
</article>
`;

function emptyModel() {
  const value = content.createDefaultAboutContent();
  value.introduction = { title: "Title", subtitle: "Subtitle", paragraph: "Paragraph" };
  value.philosophy = [];
  value.history = [];
  value.services = [];
  return value;
}

test("canonical grammar preserves empty groups and all default values with fresh objects", () => {
  const api = adapter();
  expect(api.MAX_ABOUT_HTML_BYTES).toBe(512 * 1024);
  expect(api.aboutContentToHtml(emptyModel())).toBe(emptyHtml);
  expect(api.aboutHtmlToContent(emptyHtml)).toEqual(emptyModel());
  const original = content.createDefaultAboutContent();
  const before = structuredClone(original);
  const html = api.aboutContentToHtml(original);
  expect(html.endsWith("\n")).toBe(true);
  const parsed = api.aboutHtmlToContent(html);
  expect(parsed).toEqual(original);
  expect(api.aboutContentToHtml(parsed)).toBe(html);
  expect(original).toEqual(before);
  parsed.philosophy[0].title = "not the input";
  parsed.history[0].events.push("not the input");
  parsed.services[0].description = "not the input";
  expect(original).toEqual(before);
});

test("serializes literal markup, entities, LF/tab whitespace, order and IDs losslessly", () => {
  const api = adapter();
  const value = content.createDefaultAboutContent();
  const literal = ` \t\n<&>\"' 한국어 😀 &copy; <script>alert(1)</script> \n\t `;
  value.headings = { services: literal + "s", history: literal + "h", philosophy: literal + "p", eyebrow: literal + "e" };
  value.introduction = { paragraph: literal + "body", title: literal + "title", subtitle: literal + "sub" };
  value.links = { contactLabel: literal + "c", portfolioLabel: literal + "p" };
  value.philosophy = [
    { id: "z-last-first", title: literal, subtitle: literal, paragraph: literal },
    { id: "a-first-last", title: literal + "2", subtitle: literal + "2", paragraph: literal + "2" },
  ];
  value.history = [{ year: "2026", events: [literal + "2", literal + "1"] }, { year: "1000", events: [literal] }];
  value.services = [{ name: literal + "2", description: literal }, { name: literal + "1", description: literal }];
  const before = structuredClone(value);
  const html = api.aboutContentToHtml(value);
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).toContain("&amp;copy;");
  expect(html).toContain("&lt;&amp;&gt;&quot;&#39;");
  expect(html).not.toContain("<script>");
  expect(api.aboutHtmlToContent(html)).toEqual(value);
  expect(value).toEqual(before);
  expect(api.aboutContentToHtml(api.aboutHtmlToContent(html))).toBe(html);
  const alternate = emptyHtml.replace(/\n/g, "\r\n").replace(/article/g, "ARTICLE").replace(/section/g, "SECTION")
    .replace(/="([^"]*)"/g, "='$1'").replace("Title", "T&#105;tle");
  expect(api.aboutHtmlToContent(alternate)).toEqual(emptyModel());
  expect(api.aboutContentToHtml(api.aboutHtmlToContent(alternate))).toBe(emptyHtml);
});

test("refuses lossy or parser-invalid Unicode exports without changing the draft", () => {
  const api = adapter();
  for (const bad of ["\uD800", "\uDC00", "\uFFFF", "\uFDD0", "\u{1FFFF}"]) {
    const value = emptyModel();
    value.introduction.title = `keep ${bad} unchanged`;
    const before = structuredClone(value);
    // The existing JSON contract accepts these strings; HTML must not replace them silently.
    content.validateAboutContent(value);
    expect(() => api.aboutContentToHtml(value)).toThrow(/[가-힣]/);
    expect(value).toEqual(before);
  }
});

// Actual local modules share one realm, including the strict plain-object validator.
// Only parse5 and the web-standard encoder enter from outside; Node/DOM globals do not.
function sandbox() {
  const parse5 = load("parse5") as typeof import("parse5");
  const calls = { encode: 0, tokenize: 0, tree: 0 };
  class Encoder extends TextEncoder {
    encode(input?: string) { calls.encode++; return super.encode(input); }
  }
  class Tokenizer extends parse5.Tokenizer {
    constructor(...args: ConstructorParameters<typeof parse5.Tokenizer>) { calls.tokenize++; super(...args); }
  }
  const pureParser = {
    ...parse5, Tokenizer,
    parseFragment(...args: Parameters<typeof parse5.parseFragment>) { calls.tree++; return parse5.parseFragment(...args); },
  };
  const context = vm.createContext({ TextEncoder: Encoder });
  const cache = new Map<string, { exports: unknown }>();
  function compile(file: string): unknown {
    const filename = path.resolve(root, file);
    const cached = cache.get(filename);
    if (cached) return cached.exports;
    const moduleRecord = { exports: {} };
    cache.set(filename, moduleRecord);
    const source = fs.readFileSync(filename, "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const run = vm.runInContext(`(function(require, module, exports) { ${compiled}\n})`, context);
    run((name: string) => {
      if (name === "parse5") return pureParser;
      if (!name.startsWith(".")) throw new Error(`Node/nonlocal import forbidden: ${name}`);
      return compile(path.resolve(path.dirname(filename), name) + ".ts");
    }, moduleRecord, moduleRecord.exports);
    return moduleRecord.exports;
  }
  return {
    api: compile("src/lib/aboutHtml.ts") as Adapter,
    content: compile("src/lib/aboutContent.ts") as ContentApi,
    context, calls,
  };
}

test("bounds UTF-16 before encoding and UTF-8 before tokenization or AST allocation", () => {
  const box = sandbox();
  const limit = box.api.MAX_ABOUT_HTML_BYTES;
  expect(() => box.api.aboutHtmlToContent(" ".repeat(limit + 1))).toThrow(/512 KiB/);
  expect(box.calls).toEqual({ encode: 0, tokenize: 0, tree: 0 });
  expect(() => box.api.aboutHtmlToContent("한".repeat(Math.floor(limit / 3) + 1))).toThrow(/512 KiB/);
  expect(box.calls).toEqual({ encode: 1, tokenize: 0, tree: 0 });
  for (const invalid of [null, undefined, 7, {}, [emptyHtml]]) {
    expect(() => box.api.aboutHtmlToContent(invalid as unknown as string)).toThrow(/[가-힣]/);
  }
  const exact = " ".repeat(limit - new TextEncoder().encode(emptyHtml).byteLength) + emptyHtml;
  expect(new TextEncoder().encode(exact).byteLength).toBe(limit);
  expect(box.api.aboutHtmlToContent(exact)).toEqual(emptyModel());
  const before = { ...box.calls };
  expect(() => box.api.aboutHtmlToContent(exact + " ")).toThrow(/512 KiB/);
  expect(box.calls).toEqual(before);
});

test("preflight rejects depth above 16 and start tags above 6000 before a full AST", () => {
  for (const [atLimit, overLimit, message] of [
    ["<div>".repeat(16) + "x" + "</div>".repeat(16), "<div>".repeat(17) + "x" + "</div>".repeat(17), /16/],
    ["<article>" + "<div></div>".repeat(5999) + "</article>", "<article>" + "<div></div>".repeat(6000) + "</article>", /6000/],
  ] as const) {
    const box = sandbox();
    // At the resource boundary, an otherwise invalid template reaches the AST validator.
    expect(() => box.api.aboutHtmlToContent(atLimit)).toThrow(/템플릿/);
    expect(box.calls.tree).toBe(1);
    expect(() => box.api.aboutHtmlToContent(overLimit)).toThrow(message);
    expect(box.calls.tree).toBe(1);
  }
  for (const source of [
    emptyHtml.replace("Title", "<script>bad()</script>"),
    emptyHtml.replace("<nav>", "<nav onclick=x>"),
    "<!-- forbidden -->" + emptyHtml,
    "<!DOCTYPE html>" + emptyHtml,
    emptyHtml.replace("<nav>", "<nav/>"),
    emptyHtml.replace('<article data-about-document="1">', '<article data-about-document="1" data-about-document="1">'),
    emptyHtml.replace("</nav>", ""),
    emptyHtml.replace("Title", "Title &#0;"),
  ]) {
    const box = sandbox();
    expect(() => box.api.aboutHtmlToContent(source)).toThrow(/[가-힣]/);
    expect(box.calls.tree).toBe(0);
  }
});

test("counts all AST nodes, not just elements, and rejects above 12000", () => {
  const parse5 = load("parse5") as typeof import("parse5");
  const atLimit = "<article> " + "<div>x</div> ".repeat(3999) + "</article>";
  const overLimit = "<article> " + "<div>x</div> ".repeat(4000) + "</article>";
  function nodes(source: string) {
    const pending: import("parse5").DefaultTreeAdapterTypes.Node[] = [parse5.parseFragment(source)];
    let count = 0;
    while (pending.length) {
      const node = pending.pop()!;
      count++;
      if ("childNodes" in node) pending.push(...node.childNodes);
    }
    return count;
  }
  expect(nodes(atLimit)).toBe(12000);
  expect(nodes(overLimit)).toBe(12003);
  const box = sandbox();
  expect(() => box.api.aboutHtmlToContent(atLimit)).toThrow(/<article>/);
  expect(box.calls.tree).toBe(1);
  expect(() => box.api.aboutHtmlToContent(overLimit)).toThrow(/12000/);
  expect(box.calls.tree).toBe(2);
});

test("accepts validated null-prototype/frozen inputs and never shares returned objects", () => {
  const api = adapter();
  const value = content.createDefaultAboutContent();
  for (const object of [value, value.headings, value.introduction, value.links, ...value.philosophy, ...value.history, ...value.services]) {
    Object.setPrototypeOf(object, null);
  }
  function freeze(node: unknown): void {
    if (!node || typeof node !== "object") return;
    for (const child of Object.values(node)) freeze(child);
    Object.freeze(node);
  }
  freeze(value);
  content.validateAboutContent(value);
  const html = api.aboutContentToHtml(value);
  const first = api.aboutHtmlToContent(html);
  const second = api.aboutHtmlToContent(html);
  first.headings.eyebrow = "changed";
  first.philosophy.reverse();
  first.history[0].events[0] = "changed";
  expect(second).toEqual(value);
  expect(api.aboutContentToHtml(value)).toBe(html);
});

test("round-trips maximum legal JSON bytes and every maximum list cardinality without conflating HTML limits", () => {
  const api = adapter();
  const value = emptyModel();
  value.introduction.paragraph = "한글";
  value.philosophy = Array.from({ length: 12 }, (_, i) => ({ id: `id-${i}`, title: "x", subtitle: "x", paragraph: "x" }));
  value.history = Array.from({ length: 100 }, (_, i) => ({ year: String(1000 + i), events: Array.from({ length: 30 }, () => "x") }));
  value.services = Array.from({ length: 30 }, (_, i) => ({ name: `service-${i}`, description: "x" }));
  const bytes = () => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  let remaining = content.MAX_ABOUT_CONTENT_BYTES - bytes();
  const fields: [Record<string, string>, string, number][] = [
    [value.introduction, "paragraph", 6000],
    ...value.philosophy.map(entry => [entry, "paragraph", 6000] as [Record<string, string>, string, number]),
    ...value.services.map(entry => [entry, "description", 2000] as [Record<string, string>, string, number]),
  ];
  for (const [entry, key, limit] of fields) {
    const add = Math.min(remaining, limit - entry[key].length);
    entry[key] += "&".repeat(add);
    remaining -= add;
  }
  expect(remaining).toBe(0);
  expect(bytes()).toBe(65536);
  content.validateAboutContent(value);
  const before = structuredClone(value);
  const html = api.aboutContentToHtml(value);
  const htmlBytes = new TextEncoder().encode(html).byteLength;
  expect(htmlBytes).toBeGreaterThan(65536);
  expect(htmlBytes).toBeLessThanOrEqual(api.MAX_ABOUT_HTML_BYTES);
  expect(api.aboutHtmlToContent(html)).toEqual(value);
  // An exact 512 KiB legal document, with a full payload rather than oversized JSON.
  const exact = " ".repeat(api.MAX_ABOUT_HTML_BYTES - htmlBytes) + html;
  expect(new TextEncoder().encode(exact).byteLength).toBe(api.MAX_ABOUT_HTML_BYTES);
  expect(api.aboutHtmlToContent(exact)).toEqual(value);
  expect(() => api.aboutHtmlToContent(exact + " ")).toThrow(/512 KiB/);
  expect(value).toEqual(before);
});

test("uses the unchanged strict model validator on both directions", () => {
  const api = adapter();
  const valid = content.createDefaultAboutContent();
  const html = api.aboutContentToHtml(valid);
  const invalidSources = [
    html.replace(valid.philosophy[1].id, valid.philosophy[0].id),
    html.replace(valid.philosophy[0].id, "about-introduction"),
    html.replace(valid.philosophy[0].id, "Bad Id"),
    html.replace(`<time>${valid.history[1].year}</time>`, `<time>${valid.history[0].year}</time>`),
    html.replace(`<time>${valid.history[0].year}</time>`, "<time>0999</time>"),
    html.replace(`<dt>${valid.services[1].name}</dt>`, `<dt>${valid.services[0].name}</dt>`),
    emptyHtml.replace("Title", " "),
    emptyHtml.replace("Title", "x".repeat(241)),
    emptyHtml.replace("Paragraph", "x".repeat(6001)),
    emptyHtml.replace("<ol>\n    </ol>", "<ol><li><time>2026</time><ul></ul></li></ol>"),
    emptyHtml.replace("<ol>\n    </ol>", `<ol><li><time>2026</time><ul>${"<li>x</li>".repeat(31)}</ul></li></ol>`),
    emptyHtml.replace("<dl>\n    </dl>", `<dl>${Array.from({ length: 31 }, (_, i) => `<div><dt>name-${i}</dt><dd>x</dd></div>`).join("")}</dl>`),
    emptyHtml.replace("Title", "x&#13;"),
    emptyHtml.replace("Title", "x&#127;"),
  ];
  for (const source of invalidSources) expect(() => api.aboutHtmlToContent(source)).toThrow(/[가-힣]/);
  const mutations = [
    (v: typeof valid) => { (v as unknown as Record<string, unknown>).extra = true; },
    (v: typeof valid) => { v.philosophy[1].id = v.philosophy[0].id; },
    (v: typeof valid) => { v.history[0].events = []; },
    (v: typeof valid) => { v.introduction.title = " "; },
    (v: typeof valid) => { v.services[0].description = "x".repeat(2001); },
    (v: typeof valid) => { Object.defineProperty(v.introduction, "title", { get() { throw new Error("getter executed"); } }); },
  ];
  for (const mutate of mutations) {
    const value = content.createDefaultAboutContent();
    mutate(value);
    expect(() => api.aboutContentToHtml(value)).toThrow(/[가-힣]/);
  }
});

test("runs the real adapter and validator in a browser-like realm without DOM or Node globals", () => {
  const box: ReturnType<typeof sandbox> = sandbox();
  for (const name of ["window", "document", "DOMParser", "HTMLElement", "process", "Buffer", "global", "fetch"]) {
    expect(vm.runInContext(`typeof ${name}`, box.context), name).toBe("undefined");
  }
  const value = box.content.createDefaultAboutContent();
  const html = box.api.aboutContentToHtml(value);
  const parsed = box.api.aboutHtmlToContent(html);
  const modelApi: ContentApi = box.content;
  modelApi.validateAboutContent(parsed);
  expect(parsed).toEqual(content.createDefaultAboutContent());
  expect(box.api.aboutContentToHtml(parsed)).toBe(html);
  expect(Object.keys(box.api).sort()).toEqual(["MAX_ABOUT_HTML_BYTES", "aboutContentToHtml", "aboutHtmlToContent"]);
  const source = fs.readFileSync(path.join(root, "src/lib/aboutHtml.ts"), "utf8");
  expect(source).not.toMatch(/dangerouslySetInnerHTML|innerHTML|DOMParser|srcDoc|\bprocess\b|\bBuffer\b/);
});

test("rejects unsafe syntax, duplicate attributes, implicit repairs and non-template HTML", () => {
  const api = adapter();
  const mutations = [
    `<!DOCTYPE html>${emptyHtml}`,
    `<!-- hidden -->${emptyHtml}`,
    `${emptyHtml}<!-- hidden -->`,
    emptyHtml.replace("<nav>", "<nav/><nav>"),
    emptyHtml.replace("<nav>", "<nav disabled>"),
    emptyHtml.replace("<nav>", "<nav onclick=alert(1)>"),
    emptyHtml.replace("<nav>", "<nav style=display:none>"),
    emptyHtml.replace('<article data-about-document="1">', '<article data-about-document="1" data-about-document="1">'),
    emptyHtml.replace('<article data-about-document="1">', '<article DATA-ABOUT-DOCUMENT="1" data-about-document="1">'),
    emptyHtml.replace("</nav>", ""),
    emptyHtml.replace("</nav>", "</section></nav>"),
    emptyHtml.replace("</nav>", "</nav></nav>"),
    emptyHtml.replace("</article>", "</article broken>"),
    emptyHtml.replace("</article>", "</article/>"),
    emptyHtml.replace("Title", "<em>Title</em>"),
    emptyHtml.replace("Title", "<script>alert(1)</script>"),
    emptyHtml.replace("Title", "<style>body{display:none}</style>"),
    emptyHtml.replace("Title", "<svg><script>alert(1)</script></svg>"),
    emptyHtml.replace("Title", "<math><mi>x</mi></math>"),
    emptyHtml.replace("Title", "<iframe srcdoc='x'></iframe>"),
    emptyHtml.replace("Title", "<img src=x onerror=alert(1)>"),
    emptyHtml.replace("Title", "<p>Title</p>"),
    emptyHtml.replace("Title", "Title &unknown;"),
    emptyHtml.replace("Title", "Title &#0;"),
    emptyHtml.replace("Title", "Title &amp"),
    emptyHtml.replace("Title", "Title\u0000"),
    emptyHtml.replace("Title", "Title\uD800"),
    emptyHtml.replace("Title", "Title\uFFFF"),
    emptyHtml.replace("<nav>", "<nav xmlns='http://www.w3.org/1999/xhtml'>"),
    emptyHtml.replace('href="/portfolio"', 'href="javascript:alert(1)"'),
    emptyHtml.replace('href="/portfolio"', 'href="https://example.com/portfolio"'),
    emptyHtml.replace('href="/portfolio"', 'href="//example.com/portfolio"'),
    emptyHtml.replace('href="/portfolio"', 'href="/portfolio?x=1"'),
    emptyHtml.replace('href="/portfolio"', 'href="/contact"'),
    emptyHtml.replace('href="/portfolio"', 'HREF="/portfolio" target="_blank"'),
    emptyHtml.replace('data-about-field="title"', 'data-about-field="unknown"'),
    emptyHtml.replace('data-about-section="history"', 'data-about-section="services"'),
    emptyHtml.replace("<ol>", "<ol>not structural whitespace"),
    emptyHtml.replace("<ol>", "<ol>&nbsp;"),
    emptyHtml.replace("<ol>\n    </ol>", ""),
    emptyHtml.replace("<h2>Our Services</h2>", "<h2>Our Services</h2><h2>Extra</h2>"),
    emptyHtml.replace("<h2>Our Services</h2>", "<h2>Our Services</h2><section></section>"),
    emptyHtml + emptyHtml,
    `unmarked text${emptyHtml}`,
    `<?xml version='1.0'?>${emptyHtml}`,
    emptyHtml.replace("Title", "<![CDATA[Title]]>"),
  ];
  for (const source of mutations) expect(() => api.aboutHtmlToContent(source), source.slice(0, 160)).toThrow(/[가-힣]/);
});
