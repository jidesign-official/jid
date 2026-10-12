import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import portfolioData from "../../public/images/portfolio/portfolio_data.json";
import { getProjectModelPaths } from "../../src/lib/portfolioModels";

type DetailImage = { src: string; filename: string; width: number; height: number; ratio: number };
function detailImages(folder: string): DetailImage[] {
  const helper = path.join(process.cwd(), "src/lib/portfolioImages.ts");
  const filename = fs.existsSync(helper) ? helper : path.join(process.cwd(), "src/app/portfolio/[id]/page.tsx");
  const source = fs.readFileSync(filename, "utf8") + "\nexports.inspectImages = getProjectDetailImages;";
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports: { inspectImages?: (folder: string) => DetailImage[] } = {};
  vm.runInNewContext(compiled, { exports, process, Buffer, require: (name: string) => {
    if (["fs", "node:fs"].includes(name)) return fs;
    if (["path", "node:path"].includes(name)) return path;
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name.endsWith("portfolio_data.json")) return portfolioData;
    if (name === "@/lib/portfolioModels") return { getProjectModelPaths };
    if (name === "@/lib/basePath") return { getAssetPath: (value: string) => value };
    return () => null;
  } }, { filename });
  return exports.inspectImages!(folder);
}

test("JPEG sequence metadata preserves all eleven supplied 730x400 frame dimensions instead of the PNG-only fallback", () => {
  const images = detailImages("jd038");
  for (let index = 2; index <= 12; index++) {
    expect(images.find((image) => image.filename === `jd038_${index}.jpg`)).toMatchObject({
      src: `/images/portfolio/jd038/jd038_${index}.jpg`, width: 730, height: 400, ratio: 1.82,
    });
  }
});

test("jd038 discovers all sixteen source images and displays 13 through 16 as bounded ordinary images", () => {
  const images = detailImages("jd038");
  expect(images.map((image) => image.filename)).toEqual([
    "jd038_1.png", ...Array.from({ length: 15 }, (_, index) => `jd038_${index + 2}.jpg`),
  ]);
  for (let index = 13; index <= 16; index++) {
    expect(images.find((image) => image.filename === `jd038_${index}.jpg`)).toMatchObject({
      src: `/images/portfolio/optimized/jd038/jd038_${index}.webp`, width: 2048,
    });
  }
});

test("detail images preserve numeric ordering and exclude thumbnails for all nine new folders", () => {
  for (let index = 37; index <= 45; index++) {
    const id = `jd${String(index).padStart(3, "0")}`;
    const original = fs.readdirSync(path.join(process.cwd(), "public/images/portfolio", id))
      .filter((file) => !file.startsWith(".") && !file.includes("thumbs") && /\.(png|jpe?g|webp)$/i.test(file))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    expect(detailImages(id).map((image) => image.filename)).toEqual(original);
  }
});

test("detail images use bounded display derivatives when available and retain supplied originals", () => {
  const images = detailImages("jd040");
  const first = images.find((image) => image.filename === "jd040_1.jpg")!;
  expect(first.src).toBe("/images/portfolio/optimized/jd040/jd040_1.webp");
  expect(Math.max(first.width, first.height)).toBeLessThanOrEqual(2048);
  expect(fs.statSync(path.join(process.cwd(), "public/images/portfolio/jd040/jd040_1.jpg")).size).toBe(16322749);
});
