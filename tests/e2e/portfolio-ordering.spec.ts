import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import portfolioData from "../../public/images/portfolio/portfolio_data.json";
import { getProjectModelPaths } from "../../src/lib/portfolioModels";
import { modelProjects } from "./helpers/model-cases";
import { getPortfolioCatalog } from "../../src/lib/portfolioCatalog";
import { getPortfolioManagement } from "../../src/lib/portfolioManagement";

type Project = { id: string; folder?: string };
type SortProjects = <T extends Project>(projects: readonly T[]) => T[];
type ElementProps = { children?: ReactNode; projects?: Project[]; onClick?: () => void; disabled?: boolean; href?: string };

// Run the actual TS modules while isolating only client framework dependencies.
function loadModule(relative: string, dependencies: Record<string, unknown>) {
  const filename = path.join(process.cwd(), relative);
  if (!fs.existsSync(filename)) return {} as Record<string, unknown>;
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(compiled, {
    exports, process,
    require: (id: string) => {
      if (Object.hasOwn(dependencies, id)) return dependencies[id];
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id === "node:fs") return fs;
      if (id === "node:path") return path;
      if (id === "@/lib/portfolioModels" || id === "./portfolioModels") return { getProjectModelPaths };
      if (id.endsWith("portfolio_data.json")) return portfolioData;
      if (id === "@/lib/portfolioCatalog") return { getPortfolioCatalog };
      if (id === "@/lib/portfolioManagement") return { getPortfolioManagement };
      throw new Error(`Unexpected portfolio dependency: ${id}`);
    },
  }, { filename });
  return exports;
}

function sorter(): SortProjects {
  const sort = loadModule("src/lib/portfolioOrdering.ts", {}).sortPortfolioProjects;
  expect(typeof sort, "the actual server ordering helper must be exported").toBe("function");
  return sort as SortProjects;
}

function withAssets<T>(sizes: Record<string, number>, run: () => T): T {
  const exists = fs.existsSync;
  const stat = fs.statSync;
  fs.existsSync = ((file) => Object.hasOwn(sizes, path.basename(String(file)))) as typeof fs.existsSync;
  Reflect.set(fs, "statSync", ((file: fs.PathLike) => {
    const filename = path.basename(String(file));
    expect(String(file)).toBe(path.join(process.cwd(), "public/images/glb", filename));
    expect(Object.hasOwn(sizes, filename), "stat only available explicit web assets").toBe(true);
    return { size: sizes[filename] };
  }) as typeof fs.statSync);
  try { return run(); }
  finally { fs.existsSync = exists; Reflect.set(fs, "statSync", stat); }
}

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}

// Pure behavioral harness: invokes real Grid event handlers and rerenders state.
function gridHarness() {
  const state: unknown[] = [];
  let cursor = 0;
  const Grid = loadModule("src/components/portfolio/PortfolioGrid.tsx", {
    react: {
      useState: (initial: unknown) => {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (next: unknown) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
      },
      useRef: () => ({ current: null }),
    },
    "@gsap/react": { useGSAP: () => undefined },
    "@/lib/gsap": { gsap: {} },
    "next/link": { default: "a", __esModule: true },
    "@/lib/basePath": { getAssetPath: (asset: string) => asset },
  }).default as (props: { projects: typeof portfolioData }) => ReactNode;
  return {
    render(projects = portfolioData) { cursor = 0; return elements(Grid({ projects })); },
    state,
  };
}

function button(nodes: ReturnType<typeof elements>, text: string) {
  return nodes.find((node) => node.type === "button" && textContent(node.props.children) === text)!;
}
function textContent(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement<ElementProps>(node)) return textContent(node.props.children);
  return node == null || typeof node === "boolean" ? "" : String(node);
}
function links(nodes: ReturnType<typeof elements>) {
  return nodes.filter((node) => typeof node.props.href === "string").map((node) => node.props.href);
}

test("ordering helper pins jd038 even without models and returns a fresh stable array", () => {
  const sort = sorter();
  const input = Object.freeze([{ id: "jd002", marker: 1 }, { id: "jd038", marker: 2 }, { id: "jd999", marker: 3 }]);
  const result = withAssets({}, () => sort(input));
  expect(result.map(({ id }) => id)).toEqual(["jd038", "jd002", "jd999"]);
  expect(result).not.toBe(input);
  expect(result[0]).toBe(input[1]);
  expect(input.map(({ id }) => id)).toEqual(["jd002", "jd038", "jd999"]);
});

test("ordering helper ranks available mapped model counts descending using folder or id", () => {
  const sort = sorter();
  withAssets({ "jd003_web.glb": 1, "jd015_c-001_web.glb": 100, "jd015_c-002_web.glb": 100,
    "jd023-001_web.glb": 500, "jd023-002_web.glb": 500, "jd023-003_web.glb": 500 }, () => {
    expect(sort([{ id: "jd002" }, { id: "alias", folder: "jd003" }, { id: "jd015_c" },
      { id: "jd023", folder: "" }, { id: "jd038" }]).map(({ id }) => id))
      .toEqual(["jd038", "jd023", "jd015_c", "alias", "jd002"]);
  });
});

test("ordering helper compares TOTAL mapped GLB bytes for equal positive counts with stable ties", () => {
  const sort = sorter();
  withAssets({ "jd023-001_web.glb": 100, "jd023-002_web.glb": 300,
    "jd015_c-001_web.glb": 200, "jd015_c-002_web.glb": 50,
    "jd003_web.glb": 50, "jd001_web.glb": 50 }, () => {
    expect(sort([{ id: "jd023" }, { id: "jd001" }, { id: "jd015_c" }, { id: "jd003" }]).map(({ id }) => id))
      .toEqual(["jd015_c", "jd023", "jd001", "jd003"]);
  });
});

test("ordering helper filters missing mapped assets without legacy or unlisted fallbacks", () => {
  const sort = sorter();
  withAssets({ "jd023-001_web.glb": 300, "jd015_c-001_web.glb": 5, "jd015_c-002_web.glb": 5,
    "jd003_web.glb": 1, "jd002_web.glb": 1, "jd023.glb": 1, "unlisted.glb": 1 }, () => {
    expect(sort([{ id: "jd023" }, { id: "jd002" }, { id: "jd003" }, { id: "jd015_c" }]).map(({ id }) => id))
      .toEqual(["jd015_c", "jd003", "jd023", "jd002"]);
  });
});

test("ordering helper never stats unsafe or inherited folder names and keeps model-less input stable", () => {
  const sort = sorter();
  const input = ["jd999", "../jd003", "constructor", "__proto__", "toString", "/images/glb/jd003_web.glb", "jd002"]
    .map((folder, index) => ({ id: `unmapped-${index}`, folder }));
  withAssets({ "jd003_web.glb": 1, "jd002.glb": 1, "jd002_web.glb": 1 }, () => {
    expect(sort(input)).toEqual(input);
    expect(sort([])).toEqual([]);
  });
});

// Independent filename allowlist, never the production resolver or sorter.
function expectedProjects() {
  const ranked = portfolioData.map((project, index) => {
    const filenames = modelProjects.find(({ id }) => id === (project.folder || project.id))?.files ?? [];
    const available = filenames.filter((file) => fs.existsSync(path.join(process.cwd(), "public/images/glb", file)));
    return { project, index, count: available.length,
      bytes: available.reduce((total, file) => total + fs.statSync(path.join(process.cwd(), "public/images/glb", file)).size, 0) };
  });
  const pinned = ranked.filter(({ project }) => project.id === "jd038");
  const rest = ranked.filter(({ project }) => project.id !== "jd038");
  const counts = [...new Set(rest.map(({ count }) => count))].sort((a, b) => b - a);
  return [...pinned, ...counts.flatMap((count) => {
    const group = rest.filter((item) => item.count === count);
    return count === 0 ? group : group.sort((a, b) => a.bytes - b.bytes || a.index - b.index);
  })].map(({ project }) => project);
}

test("server portfolio page passes independently ordered metadata as Grid projects", () => {
  const PageComponent = loadModule("src/app/portfolio/page.tsx", {
    "@/components/portfolio/PortfolioGrid": { default: () => null, __esModule: true },
    "@/lib/portfolioOrdering": { sortPortfolioProjects: sorter() },
  }).default as () => ReactNode;
  const grid = elements(PageComponent()).find((node) => typeof node.type === "function")!;
  expect(grid.props.projects).toEqual(expectedProjects());
});

test("grid next button advances exactly one page instead of jumping to the final page", () => {
  const grid = gridHarness();
  const before = grid.render();
  const first = links(before);
  button(before, "다음").props.onClick!();
  const after = grid.render();
  expect(grid.state[1]).toBe(2);
  expect(links(after)).toEqual(portfolioData.slice(20, 40).map(({ id }) => `/portfolio/${id}`));
  expect(links(after)).not.toEqual(first);
});

test("grid uses supplied order and counts, resets tabs, and communicates empty UX/UI", () => {
  const grid = gridHarness();
  const ordered = [...portfolioData].reverse();
  let nodes = grid.render(ordered);
  expect(links(nodes)).toEqual(ordered.slice(0, 20).map(({ id }) => `/portfolio/${id}`));
  expect(button(nodes, `모든 프로젝트 (${ordered.length})`)).toBeDefined();
  button(nodes, "다음").props.onClick!();
  nodes = grid.render(ordered);
  const products = ordered.filter(({ category }) => category === "Product");
  button(nodes, `Product (${products.length})`).props.onClick!();
  nodes = grid.render(ordered);
  expect(grid.state[1]).toBe(1);
  expect(links(nodes)).toEqual(products.slice(0, 20).map(({ id }) => `/portfolio/${id}`));
  button(nodes, "UX/UI (0)").props.onClick!();
  nodes = grid.render(ordered);
  expect(links(nodes)).toEqual([]);
  expect(nodes.some((node) => node.props.children === "프로젝트가 없습니다.")).toBe(true);
  expect(button(nodes, "다음")).toBeUndefined();
  button(nodes, `모든 프로젝트 (${ordered.length})`).props.onClick!();
  expect(links(grid.render(ordered))).toEqual(ordered.slice(0, 20).map(({ id }) => `/portfolio/${id}`));
});

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
function cards(page: Page) {
  return page.locator(`section a[href^="${basePath}/portfolio/jd"]`);
}
async function cardIds(page: Page) {
  return cards(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")!.split("/").filter(Boolean).at(-1)));
}

test("browser portfolio pins jd038 first (cannot pass the old unsorted list)", async ({ page }) => {
  await page.goto(`${basePath}/portfolio/`);
  await expect(cards(page).first()).toHaveAttribute("href", new RegExp(`${basePath}/portfolio/jd038/?$`));
});

test("browser next advances exactly one page rather than jumping to the last", async ({ page }) => {
  await page.goto(`${basePath}/portfolio/`);
  await expect(cards(page)).toHaveCount(20);
  const firstPage = await cardIds(page);
  await page.getByRole("button", { name: "2", exact: true }).click();
  await expect(cards(page)).toHaveCount(20);
  await expect.poll(() => cardIds(page)).not.toEqual(firstPage);
  const secondPage = await cardIds(page);
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect.poll(() => cardIds(page)).toEqual(secondPage);
});

test("browser all four pages cover exactly 69 projects in independent model-count and byte-size order", async ({ page }) => {
  const ordered = expectedProjects();
  expect(portfolioData).toHaveLength(69);
  expect(modelProjects).toHaveLength(34);
  expect(modelProjects.flatMap(({ files }) => files)).toHaveLength(38);
  expect(ordered[0].id).toBe("jd038");
  for (const { files } of modelProjects) {
    for (const file of files) expect(fs.existsSync(path.join(process.cwd(), "public/images/glb", file)), file).toBe(true);
  }
  await page.goto(`${basePath}/portfolio/`);
  await expect(page.getByRole("button", { name: "모든 프로젝트 (69)", exact: true })).toBeVisible();
  const seen: (string | undefined)[] = [];
  for (let index = 0; index < 4; index++) {
    const expected = ordered.slice(index * 20, (index + 1) * 20).map(({ id }) => id);
    await expect(cards(page)).toHaveCount(expected.length);
    await expect.poll(() => cardIds(page)).toEqual(expected);
    seen.push(...await cardIds(page));
    const previous = page.getByRole("button", { name: "이전", exact: true });
    const next = page.getByRole("button", { name: "다음", exact: true });
    if (index === 0) await expect(previous).toBeDisabled();
    else await expect(previous).toBeEnabled();
    if (index === 3) await expect(next).toBeDisabled();
    else await expect(next).toBeEnabled();
    if (index < 3) await page.getByRole("button", { name: "다음", exact: true }).click();
  }
  expect(seen).toHaveLength(69);
  expect(new Set(seen).size).toBe(69);
  expect([...seen].sort()).toEqual(portfolioData.map(({ id }) => id).sort());
  // Backwards traversal must preserve exactly the same per-page order.
  for (let index = 2; index >= 0; index--) {
    await page.getByRole("button", { name: "이전", exact: true }).click();
    await expect.poll(() => cardIds(page)).toEqual(ordered.slice(index * 20, (index + 1) * 20).map(({ id }) => id));
  }
});

test("browser tab changes reset pagination without losing order or counts and show empty UX/UI", async ({ page }) => {
  const ordered = expectedProjects();
  const products = ordered.filter(({ category }) => category === "Product");
  expect(ordered.filter(({ category }) => category === "UX/UI")).toHaveLength(0);
  await page.goto(`${basePath}/portfolio/`);
  await page.getByRole("button", { name: "3", exact: true }).click();
  await page.getByRole("button", { name: `Product (${products.length})`, exact: true }).click();
  await expect.poll(() => cardIds(page)).toEqual(products.slice(0, 20).map(({ id }) => id));
  await expect(page.getByRole("button", { name: "이전", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect.poll(() => cardIds(page)).toEqual(products.slice(20, 40).map(({ id }) => id));
  await page.getByRole("button", { name: "UX/UI (0)", exact: true }).click();
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("프로젝트가 없습니다.");
  await expect(page.getByRole("button", { name: "다음", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: `모든 프로젝트 (${ordered.length})`, exact: true }).click();
  await expect.poll(() => cardIds(page)).toEqual(ordered.slice(0, 20).map(({ id }) => id));
  await expect(page.getByRole("button", { name: "이전", exact: true })).toBeDisabled();
});
