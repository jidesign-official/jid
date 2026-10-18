import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import legacy from "../../public/images/portfolio/portfolio_data.json";
import titles from "./fixtures/portfolio-titles.json";

const nativeRequire = createRequire(path.join(process.cwd(), "package.json"));
const defaults = ["jd025_c", "jd008_b", "jd005_b", "jd013"];
const editedFeatured = ["jd002", "jd013", "jd008_b", "jd025_c"];
const component = (name: string) => ({ __esModule: true, default: name });
type Props = { children?: ReactNode; [key: string]: unknown };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}

// Only framework/client leaves are replaced. Catalog/settings/order/model code
// executes from the repository; settings are written solely in an isolated root.
function load(relative: string, dependencies: Record<string, unknown> = {}): Record<string, unknown> {
  const filename = path.resolve(relative);
  const loaded = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    module: loaded, exports: loaded.exports, process, Buffer, TextEncoder, TextDecoder,
    require: (id: string) => {
      if (Object.hasOwn(dependencies, id)) return dependencies[id];
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id.endsWith(".json")) return nativeRequire(path.resolve(path.dirname(filename), id));
      if (id.startsWith("@/")) return load(`src/${id.slice(2)}.ts`, dependencies);
      if (id.startsWith(".")) return load(path.resolve(path.dirname(filename), `${id}.ts`), dependencies);
      return nativeRequire(id);
    },
  }, { filename });
  return loaded.exports;
}
function fixture() {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), "jid-public-settings-"));
  const write = (settings: unknown) => fs.writeFileSync(path.join(root, "portfolio-settings.json"), JSON.stringify(settings));
  const dependencies = {
    "next/link": component("a"),
    "next/navigation": { notFound: () => { throw new Error("PUBLIC_NOT_FOUND"); } },
    "@/components/home/Hero": component("hero"),
    "@/components/home/PromoGrid": component("promo-grid"),
    "@/components/portfolio/PortfolioGrid": component("portfolio-grid"),
    "@/components/portfolio/PortfolioBody": component("cms-body"),
    "@/components/portfolio/DetailGalleryView": component("gallery"),
    "@/components/portfolio/Model3DViewer": component("model-viewer"),
    "@/lib/portfolioManagement": {
      getPortfolioManagement: () => (load("src/lib/portfolioManagement.ts").getPortfolioManagement as (root: string) => unknown)(root),
    },
  };
  return {
    root, write,
    page: (relative: string) => load(relative, dependencies),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
const editedSettings = () => ({ schemaVersion: 1, order: [...legacy].reverse().map(({ id }) => id), hidden: ["jd038"], featured: editedFeatured });
type SyncPage = () => ReactNode;
type DetailProps = { params: Promise<{ id: string }> };
type DetailPage = (props: DetailProps) => Promise<ReactNode>;

test("public management representative cards remain image-only and use generic accessible project links", () => {
  const Promo = load("src/components/home/PromoGrid.tsx", {
    react: { useRef: () => ({ current: null }) },
    "@gsap/react": { useGSAP: () => undefined },
    "@/lib/gsap": { gsap: {} },
    "next/link": component("a"),
    "next/image": component("image"),
  }).default as (props: { projects: typeof legacy }) => ReactNode;
  const projects = editedFeatured.map((id) => legacy.find((project) => project.id === id)!);
  const tree = elements(Promo({ projects }));
  expect(tree.find((node) => node.type === "section")!.props["aria-label"]).toBe("대표 프로젝트");
  const cards = tree.filter((node) => node.type === "a");
  expect(cards.map((node) => node.props.href)).toEqual(editedFeatured.map((id) => `/portfolio/${id}/`));
  expect(cards.map((node) => node.props["aria-label"])).toEqual(projects.map(({ title }) => `${title} 프로젝트 보기`));
  expect(tree.filter((node) => node.type === "image").map((node) => node.props.src))
    .toEqual(projects.map(({ image }) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${image}`));
  for (const card of cards) {
    expect(card.props.className).toContain("h-[500px] md:h-[580px]");
    expect(card.props.className).toContain("focus-visible:outline-2");
  }
  for (const image of tree.filter((node) => node.type === "image")) {
    expect(image.props.fill).toBe(true);
    expect(image.props.className).toContain("object-cover");
    expect(image.props.className).toContain("group-hover:scale-[1.03]");
  }
  expect(tree.filter((node) => ["h2", "p", "span", "model-viewer"].includes(String(node.type)))).toEqual([]);
});

test("public management list preserves manual order and excludes hidden projects without sorting again", () => {
  const f = fixture();
  try {
    const settings = editedSettings();
    f.write(settings);
    const List = f.page("src/app/portfolio/page.tsx").default as SyncPage;
    const projects = elements(List()).find((node) => node.type === "portfolio-grid")!.props.projects as typeof legacy;
    expect(projects.map(({ id }) => id)).toEqual(settings.order.filter((id) => !settings.hidden.includes(id)));
    expect(projects).toHaveLength(68);
    for (const project of projects) expect(project).toEqual(legacy.find(({ id }) => id === project.id));
  } finally { f.cleanup(); }
});

test("public management detail routes metadata and navigation share the visible manual snapshot", async () => {
  const f = fixture();
  try {
    const settings = editedSettings();
    f.write(settings);
    const api = f.page("src/app/portfolio/[id]/page.tsx");
    const visible = settings.order.filter((id) => !settings.hidden.includes(id));
    const params = await (api.generateStaticParams as () => Promise<{ id: string }[]>)();
    expect(params).toEqual(visible.map((id) => ({ id })));
    const props = (id: string) => ({ params: Promise.resolve({ id }) });
    const metadata = api.generateMetadata as (props: DetailProps) => Promise<unknown>;
    expect(await metadata(props("jd038"))).toEqual({ title: "Project Not Found - JiD" });
    // VM async functions return a foreign-realm Promise; adopt it before Playwright's matcher.
    await expect(Promise.resolve((api.default as DetailPage)(props("jd038")))).rejects.toThrow("PUBLIC_NOT_FOUND");
    for (const [index, id] of visible.entries()) {
      const title = titles[id as keyof typeof titles];
      expect(await metadata(props(id))).toEqual({ title: `${title} - JiD`, description: `${title} 제품 디자인 포트폴리오 상세 페이지입니다.` });
      const tree = elements(await (api.default as DetailPage)(props(id)));
      expect(tree.find((node) => node.type === "h1")!.props.children).toBe(title);
      expect(tree.find((node) => node.type === "img")!.props.alt).toBe(title);
      expect(tree.filter((node) => typeof node.props.href === "string" && node.props.href.startsWith("/portfolio/"))
        .map((node) => node.props.href)).toEqual([visible[index - 1], visible[index + 1]].filter(Boolean).map((neighbor) => `/portfolio/${neighbor}`));
      if (id === "jd002") expect(tree.filter((node) => node.type === "model-viewer")).toEqual([]);
    }
  } finally { f.cleanup(); }
});

test("public management defaults preserve 69 projects and current four and restore the original visible snapshot", async () => {
  const f = fixture();
  try {
    const Home = f.page("src/app/page.tsx").default as SyncPage;
    const List = f.page("src/app/portfolio/page.tsx").default as SyncPage;
    const Detail = f.page("src/app/portfolio/[id]/page.tsx");
    const list = () => elements(List()).find((node) => node.type === "portfolio-grid")!.props.projects as typeof legacy;
    const featured = () => elements(Home()).find((node) => node.type === "promo-grid")!.props.projects as typeof legacy;
    const baseline = list();
    expect(baseline).toHaveLength(69);
    expect(baseline[0].id).toBe("jd038");
    expect([...baseline].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...legacy].sort((a, b) => a.id.localeCompare(b.id)));
    expect(featured()).toEqual(defaults.map((id) => legacy.find((project) => project.id === id)));
    expect(await (Detail.generateStaticParams as () => Promise<{ id: string }[]>)()).toEqual(baseline.map(({ id }) => ({ id })));
    f.write(editedSettings());
    expect(list()).toHaveLength(68);
    expect(featured().map(({ id }) => id)).toEqual(editedFeatured);
    f.write({ schemaVersion: 1, order: [], hidden: [], featured: defaults });
    expect(list()).toEqual(baseline);
    expect(featured()).toEqual(defaults.map((id) => legacy.find((project) => project.id === id)));
    expect(await (Detail.generateStaticParams as () => Promise<{ id: string }[]>)()).toEqual(baseline.map(({ id }) => ({ id })));
  } finally { f.cleanup(); }
});

// Node-only tests: no browser fixture, server, generated build or working-root writes.
test("public management home applies actual temporary settings including an image-only featured choice", () => {
  const f = fixture();
  try {
    f.write(editedSettings());
    const Home = f.page("src/app/page.tsx").default as SyncPage;
    const projects = elements(Home()).find((node) => node.type === "promo-grid")!.props.projects;
    expect(projects).toEqual(editedFeatured.map((id) => legacy.find((project) => project.id === id)));
    expect((load("src/lib/portfolioModels.ts").getProjectModelPaths as (id: string, root: string) => string[])("jd002", f.root)).toEqual([]);
    for (const project of projects as typeof legacy) {
      expect(project.title).toBe(titles[project.id as keyof typeof titles]);
      expect(project.image).toBe(legacy.find(({ id }) => id === project.id)!.image);
    }
  } finally { f.cleanup(); }
});
