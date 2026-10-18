import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { AboutContent } from "../../src/lib/aboutContent";

const nativeRequire = createRequire(path.join(process.cwd(), "package.json"));
type Props = { children?: ReactNode; [key: string]: unknown };
type PageModule = {
  default: () => ReactNode | Promise<ReactNode>;
  generateMetadata?: () => unknown | Promise<unknown>;
};

// Execute the real TS/TSX source. Only Next Link is replaced by its anchor leaf;
// service injection below confines all published-file reads to a temporary root.
function load(relative: string, dependencies: Record<string, unknown> = {}): Record<string, unknown> {
  const filename = path.resolve(relative);
  const loaded = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true, target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(compiled, {
    module: loaded, exports: loaded.exports, process, Buffer, TextEncoder, TextDecoder,
    require: (id: string) => {
      if (Object.hasOwn(dependencies, id)) return dependencies[id];
      if (id === "next/link") return { __esModule: true, default: "a" };
      if (id.startsWith("@/")) return load(`src/${id.slice(2)}.ts`, dependencies);
      if (id.startsWith(".")) return load(path.resolve(path.dirname(filename), `${id}.ts`), dependencies);
      return nativeRequire(id);
    },
  }, { filename });
  return loaded.exports;
}
function pageFor(content: AboutContent): PageModule {
  return load("src/app/about/page.tsx", {
    "@/lib/aboutContentServer": { getAboutContent: () => content },
  }) as PageModule;
}
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<Props>(node)) return text(node.props.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
function editedContent(): AboutContent {
  return {
    schemaVersion: 1,
    headings: { eyebrow: "Published studio", philosophy: "Published principles", history: "Published milestones", services: "Published capabilities" },
    introduction: { title: "Published introduction", subtitle: "게시된 소개", paragraph: " Published description — 게시된 설명.\n다음 줄\t끝. " },
    philosophy: [
      { id: "published-second", title: "Second principle first", subtitle: "둘째", paragraph: "Second principle paragraph" },
      { id: "published-first", title: "First principle second", subtitle: "첫째", paragraph: "First principle paragraph" },
    ],
    history: [
      { year: "2030", events: ["Later event first", "Repeated event", "Repeated event"] },
      { year: "2020", events: ["Earlier event last"] },
    ],
    services: [
      { name: "Z service", description: "Z description" },
      { name: "A service", description: "A description" },
    ],
    links: { portfolioLabel: "Published portfolio", contactLabel: "Published contact" },
  };
}

// These tests deliberately do not request browser/page/request fixtures or start
// a server. Run with E2E_BASE_URL set to disable the shared dev-server hook.
test("published introduction, section headings and CTA labels replace static copy without changing fixed semantics", async () => {
  const content = editedContent();
  const tree = elements(await Promise.resolve(pageFor(content).default()));
  const article = tree.find((node) => node.type === "article")!;
  expect(article.props["aria-label"]).toBe("About JiD");
  expect(tree.filter((node) => node.type === "h1").map((node) => text(node))).toEqual([content.introduction.title]);
  for (const value of [...Object.values(content.headings), ...Object.values(content.introduction)]) {
    expect(tree.some((node) => text(node) === value), value).toBe(true);
  }
  const nav = tree.find((node) => node.type === "nav")!;
  expect(nav.props["aria-label"]).toBe("Explore JiD");
  expect(nav.props.lang).toBe("en");
  const links = tree.filter((node) => node.type === "a");
  expect(links.map((node) => node.props.href)).toEqual(["/portfolio", "/contact"]);
  expect(links.map((node) => text(node))).toEqual([`${content.links.portfolioLabel} ↗`, `${content.links.contactLabel} →`]);
  expect(tree.find((node) => node.props.id === "about-introduction")!.props.lang).toBe("en");
  for (const value of [content.introduction.subtitle, content.introduction.paragraph]) {
    expect(tree.find((node) => text(node) === value)!.props.lang).toBe("ko");
  }
});

test("server metadata uses the published description with the fixed About title", async () => {
  const content = editedContent();
  const page = pageFor(content);
  expect(typeof page.generateMetadata).toBe("function");
  expect(await Promise.resolve(page.generateMetadata!())).toEqual({
    title: "About Us - JiD", description: content.introduction.paragraph,
  });
  expect(Object.hasOwn(page, "metadata")).toBe(false);
});

test("published lists preserve supplied order, philosophy IDs and duplicate history events with unique keys", async () => {
  const content = editedContent();
  const tree = elements(await Promise.resolve(pageFor(content).default()));
  expect(tree.filter((node) => node.type === "h3").map((node) => ({
    id: node.props.id, title: text(node), lang: node.props.lang,
  }))).toEqual(content.philosophy.map((block) => ({ id: block.id, title: block.title, lang: "en" })));
  for (const block of content.philosophy) {
    const section = tree.find((node) => node.type === "section" && node.props["aria-labelledby"] === block.id)!;
    expect(elements(section).filter((node) => node.type === "p").map((node) => text(node)))
      .toEqual([block.subtitle, block.paragraph]);
  }
  expect(tree.filter((node) => node.type === "time").map((node) => [text(node), node.props.dateTime]))
    .toEqual(content.history.map(({ year }) => [year, year]));
  const eventLists = tree.filter((node) => node.type === "ul");
  expect(eventLists.map((list) => elements(list).filter((node) => node.type === "li").map((node) => text(node))))
    .toEqual(content.history.map(({ events }) => events));
  for (const list of eventLists) {
    const keys = elements(list).filter((node) => node.type === "li").map((node) => node.key);
    expect(new Set(keys).size).toBe(keys.length);
  }
  expect(tree.filter((node) => node.type === "dt").map((node) => text(node))).toEqual(content.services.map(({ name }) => name));
  expect(tree.filter((node) => node.type === "dd").map((node) => text(node))).toEqual(content.services.map(({ description }) => description));
});

for (const omitted of [["philosophy"], ["history"], ["services"], ["philosophy", "history", "services"]] as const) {
  test(`empty published ${omitted.join("/")} lists omit only their complete sections`, async () => {
    const content = editedContent();
    for (const key of omitted) content[key] = [];
    const tree = elements(await Promise.resolve(pageFor(content).default()));
    expect(tree.filter((node) => node.type === "h1")).toHaveLength(1);
    expect(tree.filter((node) => node.type === "a")).toHaveLength(2);
    for (const key of ["philosophy", "history", "services"] as const) {
      const present = !omitted.some((value) => value === key);
      expect(tree.some((node) => node.type === "section" && node.props["aria-labelledby"] === `about-${key}`)).toBe(present);
      expect(tree.some((node) => node.props.id === `about-${key}`)).toBe(present);
    }
  });
}

function expectOriginalDefaultHtmlWithScopedWrapping(html: string) {
  const originalOpening = '<article aria-label="About JiD" class="min-h-screen bg-[#F5F5F7] text-[#1D1D1F] dark:bg-[#111111] dark:text-[#F5F5F7]">';
  const wrappedOpening = originalOpening.replace(/">$/, ' [overflow-wrap:anywhere]">');
  // Permit exactly this root class addition, not broad class/attribute stripping.
  // The frozen hash still protects every other byte of the original HTML.
  expect(html.startsWith(wrappedOpening)).toBe(true);
  expect(createHash("sha256").update(html.replace(wrappedOpening, originalOpening)).digest("hex"))
    .toBe("c9f34fe7346a5e9af6b1be729c621114949c5e354590d65dfd6649c398d706e3");
}

test("default HTML changes only by the exact inherited About wrapping class", async () => {
  const defaults = (load("src/lib/aboutContent.ts").createDefaultAboutContent as () => AboutContent)();
  const page = pageFor(defaults);
  const html = renderToStaticMarkup(await Promise.resolve(page.default()));
  // Captured from the unmodified page before content bindings, using the same
  // React renderer and anchor leaf. Covers all copy, classes, language and DOM.
  expectOriginalDefaultHtmlWithScopedWrapping(html);
  expect(await Promise.resolve(page.generateMetadata!())).toEqual({
    title: "About Us - JiD", description: defaults.introduction.paragraph,
  });
});

function inertContent(): AboutContent {
  const content = editedContent();
  const payload = '<img src=x onerror="alert(1)"> & <script>alert(2)</script>';
  for (const key of Object.keys(content.headings) as (keyof AboutContent["headings"])[]) content.headings[key] = `${key} ${payload}`;
  for (const key of Object.keys(content.introduction) as (keyof AboutContent["introduction"])[]) content.introduction[key] = `${key} ${payload}`;
  content.philosophy = content.philosophy.map((block, index) => ({
    ...block, title: `${index} title ${payload}`, subtitle: `${index} subtitle ${payload}`, paragraph: `${index} paragraph ${payload}`,
  }));
  content.history = content.history.map((entry) => ({ ...entry, events: entry.events.map((_, index) => `${index} event ${payload}`) }));
  content.services = content.services.map((_, index) => ({ name: `${index} name ${payload}`, description: `${index} description ${payload}` }));
  content.links = { portfolioLabel: `portfolio ${payload}`, contactLabel: `contact ${payload}` };
  return content;
}
function assertInertHtml(html: string, content: AboutContent) {
  const values = [
    ...Object.values(content.headings), ...Object.values(content.introduction),
    ...content.philosophy.flatMap(({ title, subtitle, paragraph }) => [title, subtitle, paragraph]),
    ...content.history.flatMap(({ events }) => events),
    ...content.services.flatMap(({ name, description }) => [name, description]), ...Object.values(content.links),
  ];
  for (const value of values) {
    const escaped = value.replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;",
    })[character]!);
    expect(html).toContain(escaped);
  }
  expect(html).not.toMatch(/<(?:script|img)\b/i);
}
test("every editable public string is React-escaped inert text, never markup", async () => {
  const content = inertContent();
  const page = pageFor(content);
  const result = await Promise.resolve(page.default());
  assertInertHtml(renderToStaticMarkup(result), content);
  expect(elements(result).some((node) => Object.hasOwn(node.props, "dangerouslySetInnerHTML"))).toBe(false);
  expect(await Promise.resolve(page.generateMetadata!())).toEqual({ title: "About Us - JiD", description: content.introduction.paragraph });
});

function publishedFixture() {
  expect(fs.existsSync("src/lib/aboutContentServer.ts"), "the actual published-content resolver must exist").toBe(true);
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), "jid-about-public-"));
  const filename = path.join(root, "about-content.json");
  const service = load("src/lib/aboutContentServer.ts") as {
    getAboutContent: (root: string) => AboutContent;
  };
  const page = load("src/app/about/page.tsx", {
    "@/lib/aboutContentServer": { getAboutContent: () => service.getAboutContent(root) },
  }) as PageModule;
  return {
    root, filename, page,
    write: (content: unknown) => fs.writeFileSync(filename, `${JSON.stringify(content, null, 2)}\n`),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test("real temporary-root publication feeds custom copy and manual order to the page and metadata", async () => {
  const fixture = publishedFixture();
  try {
    const content = editedContent();
    fixture.write(content);
    const tree = await Promise.resolve(fixture.page.default());
    expect(renderToStaticMarkup(tree)).toBe(renderToStaticMarkup(await Promise.resolve(pageFor(content).default())));
    expect(elements(tree).filter((node) => node.type === "time").map((node) => text(node))).toEqual(["2030", "2020"]);
    expect(elements(tree).filter((node) => node.type === "h3").map((node) => node.props.id)).toEqual(["published-second", "published-first"]);
    expect(elements(tree).filter((node) => node.type === "dt").map((node) => text(node))).toEqual(["Z service", "A service"]);
    expect(await Promise.resolve(fixture.page.generateMetadata!())).toEqual({ title: "About Us - JiD", description: content.introduction.paragraph });
  } finally { fixture.cleanup(); }
});

test("real publication safely renders literal markup from the validated JSON file", async () => {
  const fixture = publishedFixture();
  try {
    const content = inertContent();
    fixture.write(content);
    assertInertHtml(renderToStaticMarkup(await Promise.resolve(fixture.page.default())), content);
    expect(await Promise.resolve(fixture.page.generateMetadata!())).toEqual({ title: "About Us - JiD", description: content.introduction.paragraph });
  } finally { fixture.cleanup(); }
});

test("real publication omits empty lists while preserving intro and fixed navigation", async () => {
  const fixture = publishedFixture();
  try {
    const content = editedContent();
    for (const key of ["philosophy", "history", "services"] as const) {
      content[key] = [];
      fixture.write(content);
      const tree = elements(await Promise.resolve(fixture.page.default()));
      for (const section of ["philosophy", "history", "services"] as const) {
        expect(tree.some((node) => node.props.id === `about-${section}`)).toBe(content[section].length > 0);
      }
      expect(tree.filter((node) => node.type === "h1").map((node) => text(node))).toEqual([content.introduction.title]);
      expect(tree.filter((node) => node.type === "a").map((node) => node.props.href)).toEqual(["/portfolio", "/contact"]);
    }
  } finally { fixture.cleanup(); }
});

test("real absent/default publication restores exact original HTML after a custom publication", async () => {
  const fixture = publishedFixture();
  try {
    const defaults = (load("src/lib/aboutContent.ts").createDefaultAboutContent as () => AboutContent)();
    const baseline = renderToStaticMarkup(await Promise.resolve(fixture.page.default()));
    expectOriginalDefaultHtmlWithScopedWrapping(baseline);
    fixture.write(editedContent());
    expect(renderToStaticMarkup(await Promise.resolve(fixture.page.default()))).not.toBe(baseline);
    fixture.write(defaults);
    expect(renderToStaticMarkup(await Promise.resolve(fixture.page.default()))).toBe(baseline);
    expect(await Promise.resolve(fixture.page.generateMetadata!())).toEqual({ title: "About Us - JiD", description: defaults.introduction.paragraph });
    fs.unlinkSync(fixture.filename);
    expect(renderToStaticMarkup(await Promise.resolve(fixture.page.default()))).toBe(baseline);
  } finally { fixture.cleanup(); }
});

test("invalid published JSON fails closed for both body and metadata rather than silently showing defaults", async () => {
  const fixture = publishedFixture();
  try {
    for (const invalid of ['{"schemaVersion":', JSON.stringify({ ...editedContent(), schemaVersion: 2 })]) {
      fs.writeFileSync(fixture.filename, invalid);
      // Start in a native promise: handles sync throws and adopts VM promises.
      await expect(Promise.resolve().then(() => fixture.page.default())).rejects.toThrow();
      await expect(Promise.resolve().then(() => fixture.page.generateMetadata!())).rejects.toThrow();
    }
  } finally { fixture.cleanup(); }
});
