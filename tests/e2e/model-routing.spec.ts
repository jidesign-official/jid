import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { isValidElement, type ReactNode } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import portfolioData from "../../public/images/portfolio/portfolio_data.json";
import { getProjectModelPath, getProjectModelPaths } from "../../src/lib/portfolioModels";
import { modelProjects } from "./helpers/model-cases";
import { getProjectDetailImages } from "../../src/lib/portfolioImages";
import { sortPortfolioProjects } from "../../src/lib/portfolioOrdering";
import { pickPortfolioTagline } from "../../src/lib/portfolioTaglines";
import expectedTitles from "./fixtures/portfolio-titles.json";
import { getPortfolioCatalog } from "../../src/lib/portfolioCatalog";
import { getAdminProject } from "../../src/lib/adminProjects";
import { getPortfolioManagement } from "../../src/lib/portfolioManagement";

// Execute the real server-page selection without importing client-only CSS/GSAP.
// Client children are not rendered: their props expose the selected projects.
function homeProjectIds(): string[] {
  const filename = path.join(process.cwd(), "src/app/page.tsx");
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports: { default?: () => { props: { children: { props: { children: { props: { projects: { id: string }[] } } } }[] } } } = {};
  vm.runInNewContext(compiled, {
    exports,
    process,
    require: (id: string) => {
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id === "node:fs") return fs;
      if (id === "node:path") return path;
      if (id === "@/lib/portfolioModels") return { getProjectModelPath };
      if (id.endsWith("portfolio_data.json")) return portfolioData;
      if (id === "@/lib/portfolioCatalog") return { getPortfolioCatalog };
      if (id === "@/lib/portfolioManagement") return { getPortfolioManagement };
      if (id === "@/components/home/Hero" || id === "@/components/home/PromoGrid") return () => null;
      throw new Error(`Unexpected home-page dependency: ${id}`);
    },
  }, { filename });
  const page = exports.default!();
  return page.props.children[1].props.children.props.projects.map((project) => project.id);
}

function withAssetAvailability<T>(available: (assetPath: string) => boolean, run: () => T): T {
  const original = fs.existsSync;
  fs.existsSync = ((assetPath) => available(String(assetPath))) as typeof fs.existsSync;
  try { return run(); }
  finally { fs.existsSync = original; }
}

function ModelViewer() { return null; }

async function detailViewers(id: string) {
  const filename = path.join(process.cwd(), "src/app/portfolio/[id]/page.tsx");
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports: { default?: (props: { params: Promise<{ id: string }> }) => Promise<ReactNode> } = {};
  vm.runInNewContext(compiled, {
    exports,
    process,
    Buffer,
    require: (dependency: string) => {
      if (dependency === "react/jsx-runtime") return jsxRuntime;
      if (dependency === "fs") return fs;
      if (dependency === "path") return path;
      if (dependency === "@/lib/portfolioModels") return { getProjectModelPath, getProjectModelPaths };
      if (dependency === "@/lib/portfolioImages") return { getProjectDetailImages };
      if (dependency === "@/lib/portfolioOrdering") return { sortPortfolioProjects };
      if (dependency === "@/lib/portfolioTaglines") return { pickPortfolioTagline };
      if (dependency === "@/lib/basePath") return { getAssetPath: (assetPath: string) => assetPath };
      if (dependency.endsWith("portfolio_data.json")) return portfolioData;
      if (dependency === "@/lib/portfolioCatalog") return { getPortfolioCatalog };
      if (dependency === "@/lib/portfolioManagement") return { getPortfolioManagement };
      if (dependency === "@/lib/adminProjects") return { getAdminProject };
      if (dependency === "@/components/portfolio/Model3DViewer") return ModelViewer;
      if (dependency === "next/link" || dependency === "@/components/portfolio/DetailGalleryView" || dependency === "@/components/portfolio/PortfolioBody") return () => null;
      if (dependency === "next/navigation") return { notFound: () => { throw new Error("Project not found"); } };
      throw new Error(`Unexpected detail-page dependency: ${dependency}`);
    },
  }, { filename });
  const viewers: { modelUrl: string; projectTitle: string; key: string | null }[] = [];
  function visit(node: ReactNode) {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!isValidElement<{ children?: ReactNode; modelUrl: string; projectTitle: string }>(node)) return;
    if (node.type === ModelViewer) viewers.push({ modelUrl: node.props.modelUrl, projectTitle: node.props.projectTitle, key: node.key });
    visit(node.props.children);
  }
  visit(await exports.default!({ params: Promise.resolve({ id }) }));
  return viewers;
}

test("model routing maps the first available asset for all 34 projects", () => {
  expect(modelProjects).toHaveLength(34);
  expect(modelProjects.map(({ id }) => getProjectModelPath(id))).toEqual(
    modelProjects.map(({ files }) => `/images/glb/${files[0]}`),
  );
});

test("model routing allowlist matches 34 existing metadata folders", () => {
  const withModels = portfolioData.filter((project) => getProjectModelPath(project.folder));
  expect(withModels.map((project) => project.id).sort()).toEqual(modelProjects.map(({ id }) => id).sort());
  for (const { id } of modelProjects) {
    const projects = portfolioData.filter((project) => project.id === id);
    expect(projects).toHaveLength(1);
    expect(projects[0].folder).toBe(id);
    expect(fs.statSync(path.join(process.cwd(), "public/images/portfolio", projects[0].folder)).isDirectory()).toBe(true);
  }
});

test("model routing returns no assets for unlisted IDs even when files exist", () => {
  expect(typeof getProjectModelPaths).toBe("function");
  withAssetAvailability(() => true, () => {
    for (const id of ["jd002", "jd004", "jd999", "../jd003", "jd003_web", "constructor", "__proto__", "toString"]) {
      expect(getProjectModelPath(id), id).toBeNull();
      expect(getProjectModelPaths(id), id).toEqual([]);
    }
  });
});

test("model routing returns no assets for a missing web asset without a legacy fallback", () => {
  expect(typeof getProjectModelPaths).toBe("function");
  withAssetAvailability((assetPath) => !assetPath.endsWith("jd003_web.glb"), () => {
    expect(getProjectModelPath("jd003")).toBeNull();
    expect(getProjectModelPaths("jd003")).toEqual([]);
  });
});

test("home featured projects keep the current four even without legacy GLBs", () => {
  withAssetAvailability((assetPath) => assetPath.includes(`${path.sep}images${path.sep}glb${path.sep}`), () => {
    expect(homeProjectIds()).toEqual(["jd025_c", "jd008_b", "jd005_b", "jd013"]);
  });
});

test("home featured projects do not require a web asset because image-only choices are eligible", () => {
  withAssetAvailability((assetPath) => !assetPath.endsWith("jd005_b_web.glb"), () => {
    expect(homeProjectIds()).toEqual(["jd025_c", "jd008_b", "jd005_b", "jd013"]);
  });
});

test("model routing preserves the supplied order of all 38 instances and 38 unique assets", () => {
  expect(typeof getProjectModelPaths).toBe("function");
  const paths = modelProjects.flatMap(({ id, files }) => {
    const resolved = getProjectModelPaths(id);
    expect(resolved, id).toEqual(files.map((file) => `/images/glb/${file}`));
    return resolved;
  });
  expect(paths).toHaveLength(38);
  expect(new Set(paths).size).toBe(38);
});

test("model routing filters each missing multi-model asset while retaining ordered siblings", () => {
  expect(typeof getProjectModelPaths).toBe("function");
  for (const { id, files } of modelProjects.filter(({ files }) => files.length > 1)) {
    for (const missingFile of files) {
      withAssetAvailability((assetPath) => !assetPath.endsWith(missingFile), () => {
        const expected = files.filter((file) => file !== missingFile).map((file) => `/images/glb/${file}`);
        expect(getProjectModelPaths(id), `${id}: missing ${missingFile}`).toEqual(expected);
        expect(getProjectModelPath(id)).toBe(expected[0]);
      });
    }
    withAssetAvailability(() => false, () => {
      expect(getProjectModelPaths(id)).toEqual([]);
      expect(getProjectModelPath(id)).toBeNull();
    });
  }
});

test("detail pages render every ordered model with stable URL keys and unique multi-model titles", async () => {
  for (const { id, files } of modelProjects) {
    const title = expectedTitles[id as keyof typeof expectedTitles];
    expect(await detailViewers(id), id).toEqual(files.map((file, index) => ({
      modelUrl: `/images/glb/${file}`,
      key: `/images/glb/${file}`,
      projectTitle: files.length > 1 ? `${title} — 모델 ${index + 1}` : title,
    })));
  }
  expect(await detailViewers("jd002")).toEqual([]);
});

test("both existing jd004 records use the exact wireless-stethoscope title without changing identity or image paths", () => {
  for (const id of ["jd004_a", "jd004_b"]) {
    expect(portfolioData.find((project) => project.id === id)).toEqual({
      id,
      folder: id,
      title: "Wireless Stethoscope_UNC",
      category: "Product",
      image: `/images/portfolio/${id}/${id}_thumbs.png`,
    });
    expect(getProjectModelPath(id)).toBe(`/images/glb/${id}_web.glb`);
  }
  expect(portfolioData.some(({ id }) => id === "jd004")).toBe(false);
});
