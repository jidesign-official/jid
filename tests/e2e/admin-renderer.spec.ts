import { test, expect, type Page } from "@playwright/test";
import type { PortfolioContentBlock } from "../../src/lib/admin/types";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import legacy from "../../public/images/portfolio/portfolio_data.json";
import { modelProjects } from "./helpers/model-cases";
import { isValidElement, type ReactNode, type ReactElement } from "react";

const nativeRequire = createRequire(path.join(process.cwd(), "package.json"));
// Execute actual server modules, not replacements, against an isolated registry.
function load(
  relative: string,
  dependencies: Record<string, unknown> = {},
): Record<string, unknown> {
  const filename = path.resolve(relative);
  if (!fs.existsSync(filename)) return {};
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(
    compiled,
    {
      exports,
      process,
      Buffer,
      TextEncoder,
      TextDecoder,
      require: (id: string) => {
        if (Object.hasOwn(dependencies, id)) return dependencies[id];
        if (id.startsWith("node:")) return nativeRequire(id);
        if (id.endsWith(".json"))
          return nativeRequire(path.resolve(path.dirname(filename), id));
        if (id.startsWith("@/"))
          return load(`src/${id.slice(2)}.ts`, dependencies);
        if (id.startsWith("."))
          return load(
            path.resolve(path.dirname(filename), `${id}.ts`),
            dependencies,
          );
        return nativeRequire(id);
      },
    },
    { filename },
  );
  return exports;
}
const hash = "a".repeat(64);
const media = `/_admin_media/jd046/${hash.slice(0, 16)}`;
function project() {
  return {
    id: "jd046",
    folder: "jd046",
    title: "CMS fixture",
    category: "Product",
    image: `${media}/thumb.png`,
    blocks: [{ id: "text", type: "paragraph", text: "Plain text" }],
    models: [`${media}/model.glb`],
    packageSha256: hash,
  };
}
function fixture(run: (root: string, write: (value: unknown) => void) => void) {
  const root = fs.mkdtempSync(
    path.join(process.env.TMPDIR ?? os.tmpdir(), "jid-renderer-"),
  );
  fs.mkdirSync(path.join(root, ".generated"));
  const write = (value: unknown) =>
    fs.writeFileSync(
      path.join(root, ".generated/admin-projects.json"),
      JSON.stringify(value),
    );
  try {
    run(root, write);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("server registry accepts generated entries, treats absent/empty as empty and rejects corruption", () => {
  const api = load("src/lib/adminProjects.ts");
  expect(typeof api.getAdminProjects, "server registry reader must exist").toBe(
    "function",
  );
  const get = api.getAdminProjects as (
    root?: string,
  ) => ReturnType<typeof project>[];
  const one = api.getAdminProject as (
    id: string,
    root?: string,
  ) => ReturnType<typeof project> | undefined;
  fixture((root, write) => {
    expect(get(root)).toEqual([]);
    write({ schemaVersion: 1, projects: [] });
    expect(get(root)).toEqual([]);
    write({ schemaVersion: 1, projects: [project()] });
    expect(get(root)).toEqual([project()]);
    expect(one("jd046", root)).toEqual(project());
    expect(one("jd999", root)).toBeUndefined();
    for (const invalid of [
      null,
      {},
      { schemaVersion: 2, projects: [] },
      { schemaVersion: 1, projects: [project(), project()] },
      { schemaVersion: 1, projects: [{ ...project(), image: "/outside.png" }] },
      {
        schemaVersion: 1,
        projects: [
          {
            ...project(),
            blocks: [{ id: "bad", type: "html", text: "<script>" }],
          },
        ],
      },
    ]) {
      write(invalid);
      expect(() => get(root)).toThrow(/registry/i);
    }
    fs.writeFileSync(
      path.join(root, ".generated/admin-projects.json"),
      "not json",
    );
    expect(() => get(root)).toThrow(/registry/i);
  });
});

test("server catalog preserves all legacy fields/order and exposes only CMS metadata without collisions", () => {
  const api = load("src/lib/portfolioCatalog.ts");
  expect(
    typeof api.getPortfolioCatalog,
    "merged server catalog must exist",
  ).toBe("function");
  const get = api.getPortfolioCatalog as (root?: string) => typeof legacy;
  fixture((root, write) => {
    expect(legacy).toHaveLength(69);
    expect(get(root)).toEqual(legacy);
    write({ schemaVersion: 1, projects: [project()] });
    const result = get(root);
    expect(result.slice(0, 69)).toEqual(legacy);
    expect(result[69]).toEqual({
      id: "jd046",
      folder: "jd046",
      title: "CMS fixture",
      category: "Product",
      image: `${media}/thumb.png`,
    });
    expect(Object.keys(result[69]).sort()).toEqual([
      "category",
      "folder",
      "id",
      "image",
      "title",
    ]);
    const collision = {
      ...project(),
      id: legacy[0].id,
      folder: legacy[0].id,
      image: `/_admin_media/${legacy[0].id}/${hash.slice(0, 16)}/thumb.png`,
      models: [],
    };
    write({ schemaVersion: 1, projects: [collision] });
    expect(() => get(root)).toThrow(/legacy|collision/i);
  });
});

test("model resolver returns only existing generated files in manifest order and retains the 34/38 legacy allowlist", () => {
  const api = load("src/lib/portfolioModels.ts");
  const get = api.getProjectModelPaths as (
    id: string,
    root?: string,
  ) => string[];
  fixture((root, write) => {
    const urls = [
      `${media}/second.glb`,
      `${media}/first.glb`,
      `${media}/missing.glb`,
      `${media}/directory.glb`,
    ];
    write({ schemaVersion: 1, projects: [{ ...project(), models: urls }] });
    fs.mkdirSync(path.join(root, "public", media), { recursive: true });
    for (const url of urls.slice(0, 2))
      fs.writeFileSync(path.join(root, "public", url), "fixture");
    fs.mkdirSync(path.join(root, "public", urls[3]));
    expect(get("jd046", root)).toEqual(urls.slice(0, 2));
    fs.unlinkSync(path.join(root, "public", urls[0]));
    expect(get("jd046", root)).toEqual([urls[1]]);
    write({ schemaVersion: 1, projects: [{ ...project(), models: [] }] });
    expect(get("jd046", root)).toEqual([]);
    fs.mkdirSync(path.join(root, "public/images/glb"), { recursive: true });
    expect(modelProjects).toHaveLength(34);
    expect(modelProjects.flatMap(({ files }) => files)).toHaveLength(38);
    for (const { files } of modelProjects)
      for (const file of files)
        fs.writeFileSync(path.join(root, "public/images/glb", file), "fixture");
    for (const { id, files } of modelProjects)
      expect(get(id, root)).toEqual(files.map((file) => `/images/glb/${file}`));
    fs.writeFileSync(
      path.join(root, "public/images/glb/jd002_web.glb"),
      "not allowlisted",
    );
    expect(get("jd002", root)).toEqual([]);
  });
});

function browserBundle() {
  const entry = "src/components/portfolio/PortfolioBody.tsx";
  expect(
    fs.existsSync(entry),
    "the real reusable PortfolioBody renderer must exist",
  ).toBe(true);
  const modules: Record<string, string> = {};
  let css = "";
  for (const pkg of ["react", "react-dom", "scheduler"]) {
    const folder = path.dirname(nativeRequire.resolve(`${pkg}/package.json`));
    const files = [
      "index.js",
      ...(pkg === "react-dom" ? ["client.js"] : []),
      ...fs
        .readdirSync(path.join(folder, "cjs"))
        .filter((file) => file.endsWith(".production.js"))
        .map((file) => `cjs/${file}`),
    ];
    for (const file of files)
      modules[`${pkg}/${file}`] = fs.readFileSync(
        path.join(folder, file),
        "utf8",
      );
  }
  function add(file: string) {
    if (modules[file]) return;
    const source = fs.readFileSync(file, "utf8");
    if (file.endsWith(".css")) {
      css += source;
      const names = [...source.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map(
        (match) => match[1],
      );
      modules[file] =
        `module.exports=${JSON.stringify(Object.fromEntries(names.map((name) => [name, name])))};`;
      return;
    }
    modules[file] = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    for (const match of modules[file].matchAll(
      /require\(["']([^"']+)["']\)/g,
    )) {
      const id = match[1];
      if (!id.startsWith(".") && !id.startsWith("@/")) continue;
      const stem = id.startsWith("@/")
        ? `src/${id.slice(2)}`
        : path.posix.normalize(`${path.posix.dirname(file)}/${id}`);
      const resolved = [stem, `${stem}.tsx`, `${stem}.ts`].find((name) =>
        fs.existsSync(name),
      );
      if (!resolved) throw new Error(`Missing real renderer dependency ${id}`);
      add(resolved);
    }
  }
  add(entry);
  const factories = Object.entries(modules)
    .map(
      ([id, code]) =>
        `${JSON.stringify(id)}:function(require,module,exports){${code}\n}`,
    )
    .join(",");
  return {
    css,
    script: `const process={env:{NODE_ENV:'production',NEXT_PUBLIC_BASE_PATH:'/preview'}};
    const modules={${factories}},cache={};
    function load(id){if(cache[id])return cache[id].exports;
      const module={exports:{}};cache[id]=module;
      function req(name){let key=name;
        if(name.startsWith('@/'))key='src/'+name.slice(2);
        else if(name.startsWith('.')){const parts=(id.slice(0,id.lastIndexOf('/')+1)+name).split('/'),out=[];
          for(const part of parts){if(part==='..')out.pop();else if(part!=='.')out.push(part);}key=out.join('/');}
        else key=name+(name.endsWith('/client')?'.js':'/index.js');
        if(!modules[key])key=[key+'.tsx',key+'.ts',key+'.js'].find(k=>modules[k])||key;
        return load(key);}
      if(!modules[id])throw Error('Missing harness module '+id);modules[id](req,module,module.exports);return module.exports;}
    const React=load('react/index.js'),root=load('react-dom/client.js').createRoot(document.getElementById('root'));
    const Body=load('${entry}').default;
    window.mountBody=props=>root.render(React.createElement(Body,props));window.unmountBody=()=>root.unmount();`,
  };
}
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="teal"/></svg>';
async function mountBody(
  page: Page,
  blocks: PortfolioContentBlock[],
  blob = false,
) {
  const bundle = browserBundle();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/__admin-renderer-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#root{max-width:1024px;margin:auto}</style></head><body><div id="root"></div></body></html>',
    }),
  );
  await page.route("**/_admin_media/**", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: svg }),
  );
  await page.goto("http://renderer.invalid/__admin-renderer-harness");
  await page.addStyleTag({ content: bundle.css });
  await page.addScriptTag({ content: bundle.script });
  await page.evaluate(
    ({ blocks, svg, blob }) => {
      if (blob) {
        const src = URL.createObjectURL(
          new Blob([svg], { type: "image/svg+xml" }),
        );
        for (const block of blocks)
          if (block.type === "images")
            for (const image of block.images) image.src = src;
      }
      (window as unknown as { mountBody: (props: unknown) => void }).mountBody({
        blocks,
        projectTitle: "CMS fixture",
      });
    },
    { blocks, svg, blob },
  );
  return errors;
}
function imageBlock(
  columns: 1 | 2 | 3 | 4 = 3,
  count = 3,
): PortfolioContentBlock {
  return {
    id: "images",
    type: "images",
    columns,
    images: Array.from({ length: count }, (_, index) => ({
      src: `${media}/asset-${index}.png`,
      width: 640,
      height: 320,
      alt: `View ${index + 1}`,
      caption: `Caption ${index + 1}`,
    })),
  };
}

test("real renderer safely escapes plain text, preserves paragraphs and emits semantic content", async ({
  page,
}) => {
  const injection = '<img src=x onerror="window.compromised=true">';
  const errors = await mountBody(page, [
    { id: "h2", type: "heading", level: 2, text: injection },
    { id: "h3", type: "heading", level: 3, text: "Section" },
    {
      id: "p",
      type: "paragraph",
      text: "First line\nSecond line <script>alert(1)</script>",
    },
    { id: "rule", type: "divider" },
    { id: "space", type: "spacer", size: "large" },
    imageBlock(),
  ]);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(injection);
  await expect(page.getByRole("heading", { level: 3 })).toHaveText("Section");
  const paragraph = page.locator("p").filter({ hasText: "First line" });
  await expect(paragraph).toHaveText(
    "First line\nSecond line <script>alert(1)</script>",
  );
  expect(
    await paragraph.evaluate((el) => getComputedStyle(el).whiteSpace),
  ).toBe("pre-wrap");
  await expect(page.getByRole("separator")).toHaveCount(1);
  await expect(
    page.locator('img[src="x"],script:not(:empty) script'),
  ).toHaveCount(0);
  await expect(page.getByRole("img")).toHaveCount(3);
  await expect(page.locator("figcaption").first()).toHaveText("Caption 1");
  await expect(page.getByRole("img").first()).toHaveAttribute("alt", "View 1");
  await expect(page.getByRole("img").first()).toHaveAttribute(
    "loading",
    "lazy",
  );
  await expect(page.getByRole("img").first()).toHaveAttribute(
    "decoding",
    "async",
  );
  expect(errors).toEqual([]);
});

for (const columns of [1, 2, 3, 4] as const) {
  test(`real image grid renders twelve images in ${columns} desktop columns and one mobile column without cropping`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await mountBody(page, [imageBlock(columns, 12)]);
    const images = page.getByRole("img");
    await expect(images).toHaveCount(12);
    const grid = page.locator("[data-columns]");
    expect(
      await grid.evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      ),
    ).toBe(columns);
    await images.first().evaluate(async (el: HTMLImageElement) => el.decode());
    const bounds = await images.first().boundingBox();
    expect(bounds!.width / bounds!.height).toBeCloseTo(2, 2);
    expect(
      await images.first().evaluate((el) => getComputedStyle(el).objectFit),
    ).toBe("contain");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await grid.evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      ),
    ).toBe(1);
    const first = (await images.nth(0).boundingBox())!;
    const second = (await images.nth(1).boundingBox())!;
    expect(second.y).toBeGreaterThan(first.y + first.height);
    expect(first.width).toBeCloseTo(390, 1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
  });
}

test("image enlargement supports keyboard, focus trapping, click dismissal, 44px controls and unmount cleanup", async ({
  page,
}) => {
  const errors = await mountBody(page, [imageBlock()]);
  const opener = page.getByRole("button", {
    name: "View 1 이미지 확대",
    exact: true,
  });
  await expect(opener).toBeVisible();
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "CMS fixture 이미지 확대" });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole("button", { name: "닫기", exact: true });
  await expect(close).toBeFocused();
  await expect(dialog.getByRole("img")).toHaveAttribute("alt", "View 1");
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(
    "hidden",
  );
  for (const control of await dialog.getByRole("button").all()) {
    const bounds = (await control.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("img")).toHaveAttribute("alt", "View 2");
  await page.keyboard.press("ArrowLeft");
  await expect(dialog.getByRole("img")).toHaveAttribute("alt", "View 1");
  await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  await opener.click();
  await expect(dialog).toBeVisible();
  await dialog.click({ position: { x: 3, y: 3 } });
  await expect(dialog).not.toBeVisible();
  await opener.click();
  await close.click();
  await expect(dialog).not.toBeVisible();
  await opener.click();
  await expect(dialog).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { unmountBody: () => void }).unmountBody(),
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  await page.keyboard.press("ArrowRight");
  expect(errors).toEqual([]);
});

test("preview images retain blob URLs and decode without a deployment prefix", async ({
  page,
}) => {
  const errors = await mountBody(page, [imageBlock(1, 1)], true);
  const image = page.getByRole("img");
  await expect(image).toHaveAttribute("src", /^blob:/);
  await image.evaluate(async (el: HTMLImageElement) => el.decode());
  expect(await image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(
    640,
  );
  expect(errors).toEqual([]);
});

type NodeProps = { children?: ReactNode; [key: string]: unknown };
function elements(node: ReactNode): ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<NodeProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}
const component = (name: string) => ({ __esModule: true, default: name });
const metadata = () => {
  const { id, folder, title, category, image } = project();
  return { id, folder, title, category, image };
};
function pageDependencies() {
  const dependencies = {
    "next/link": component("a"),
    "next/navigation": {
      notFound: () => {
        throw new Error("not found");
      },
    },
    "@/components/portfolio/PortfolioBody": component("cms-body"),
    "@/components/portfolio/DetailGalleryView": component("legacy-gallery"),
    "@/components/portfolio/Model3DViewer": component("model-viewer"),
    "@/components/portfolio/PortfolioGrid": component("portfolio-grid"),
    "@/components/home/Hero": component("hero"),
    "@/components/home/PromoGrid": component("promo-grid"),
    "@/lib/portfolioCatalog": {
      getPortfolioCatalog: () => [...legacy, metadata()],
    },
    "@/lib/adminProjects": {
      getAdminProject: (id: string) => (id === "jd046" ? project() : undefined),
    },
    "@/lib/portfolioModels": {
      getProjectModelPaths: (): string[] => [],
      getProjectModelPath: () => "/images/glb/model.glb",
    },
    "@/lib/portfolioImages": {
      getProjectDetailImages: () => [
        { filename: "jd038_1.png", src: "/one.png" },
        { filename: "jd038_2.jpg", src: "/two.jpg" },
      ],
    },
    "@/lib/portfolioOrdering": {
      sortPortfolioProjects: (projects: unknown[]) => [...projects],
    },
    "@/lib/portfolioTaglines": { pickPortfolioTagline: () => "tagline" },
  };
  return Object.assign(dependencies, {
    "@/lib/portfolioManagement": {
      getPortfolioManagement: () => {
        const api = load("src/lib/portfolioManagement.ts", {
          ...dependencies,
          "./portfolioCatalog": dependencies["@/lib/portfolioCatalog"],
          "./portfolioOrdering": dependencies["@/lib/portfolioOrdering"],
        });
        return (api.getPortfolioManagement as () => unknown)();
      },
    },
  });
}

test("detail module registers CMS static params and metadata and renders CMS body instead of legacy gallery", async () => {
  const api = load("src/app/portfolio/[id]/page.tsx", pageDependencies());
  const params = await (
    api.generateStaticParams as () => Promise<{ id: string }[]>
  )();
  expect(params).toContainEqual({ id: "jd046" });
  expect(params).toHaveLength(70);
  const props = { params: Promise.resolve({ id: "jd046" }) };
  expect(
    await (api.generateMetadata as (props: unknown) => Promise<unknown>)(props),
  ).toMatchObject({ title: "CMS fixture - JiD" });
  const tree = elements(
    await (api.default as (props: unknown) => Promise<ReactNode>)(props),
  );
  const body = tree.find((node) => node.type === "cms-body")!;
  expect(body?.props.blocks).toEqual(project().blocks);
  expect(body?.props.projectTitle).toBe("CMS fixture");
  expect(tree.some((node) => node.type === "legacy-gallery")).toBe(false);
  expect(tree.some((node) => node.type === "model-viewer")).toBe(false);
  const thumbnail = tree.find(
    (node) =>
      node.type === "img" &&
      node.props.src ===
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${media}/thumb.png`,
  )!;
  expect(thumbnail).toBeDefined();
  expect(
    tree.some(
      (node) =>
        String(node.props.className).includes("max-w-[1024px]") &&
        String(node.props.className).includes("aspect-square"),
    ),
  ).toBe(true);
  expect(tree.some((node) => node.props.href === "/contact")).toBe(true);
  expect(tree.some((node) => node.props.href === "/portfolio")).toBe(true);
});

test("detail retains legacy gallery and jd038 sequence, and uses the existing viewer for available CMS models", async () => {
  const dependencies = pageDependencies();
  const api = load("src/app/portfolio/[id]/page.tsx", dependencies);
  const tree = elements(
    await (api.default as (props: unknown) => Promise<ReactNode>)({
      params: Promise.resolve({ id: "jd038" }),
    }),
  );
  expect(tree.some((node) => node.type === "cms-body")).toBe(false);
  const gallery = tree.find((node) => node.type === "legacy-gallery")!;
  expect(gallery.props.images).toEqual([
    { filename: "jd038_1.png", src: "/one.png" },
  ]);
  expect(gallery.props.sequenceFrames).toEqual([
    { filename: "jd038_2.jpg", src: "/two.jpg" },
  ]);
  dependencies["@/lib/portfolioModels"].getProjectModelPaths = () =>
    project().models;
  const cms = load("src/app/portfolio/[id]/page.tsx", dependencies);
  const cmsTree = elements(
    await (cms.default as (props: unknown) => Promise<ReactNode>)({
      params: Promise.resolve({ id: "jd046" }),
    }),
  );
  expect(
    cmsTree
      .filter((node) => node.type === "model-viewer")
      .map((node) => node.props.modelUrl),
  ).toEqual(project().models);
});

test("home and portfolio page consume catalog metadata while keeping the original four featured IDs", () => {
  const dependencies = pageDependencies();
  const supplied = [
    ...legacy.map((item) => ({ ...item, title: `catalog: ${item.title}` })),
    metadata(),
  ];
  dependencies["@/lib/portfolioCatalog"].getPortfolioCatalog = () => supplied;
  const Home = load("src/app/page.tsx", dependencies)
    .default as () => ReactNode;
  const promos = elements(Home()).find((node) => node.type === "promo-grid")!;
  expect(promos.props.projects).toEqual(
    ["jd025_c", "jd008_b", "jd005_b", "jd013"].map((id) =>
      supplied.find((item) => item.id === id),
    ),
  );
  const List = load("src/app/portfolio/page.tsx", dependencies)
    .default as () => ReactNode;
  expect(
    elements(List()).find((node) => node.type === "portfolio-grid")!.props
      .projects,
  ).toEqual(supplied);
});
