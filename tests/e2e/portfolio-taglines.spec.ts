import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import portfolioData from "../../public/images/portfolio/portfolio_data.json";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const phrases = [
  "Design that bridges imagination and intuition",
  "Between a question mark and an exclamation mark",
  "Design Beyond Form",
];
const oldText = "JiD의 디테일과 심미성이 담긴 산업/의료/제품 디자인 포트폴리오입니다.";

test("random tagline selection includes each exact phrase and requests a bounded server random integer", () => {
  const filename = path.resolve("src/lib/portfolioTaglines.ts");
  expect(fs.existsSync(filename), "a dedicated server selection helper is present").toBe(true);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: { pickPortfolioTagline?: () => string } = {};
  let value = 0;
  const maxima: number[] = [];
  vm.runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (name !== "node:crypto") throw new Error(`Unexpected tagline dependency: ${name}`);
      return { randomInt: (maximum: number) => { maxima.push(maximum); return value; } };
    },
  }, { filename });
  expect(typeof exports.pickPortfolioTagline).toBe("function");
  for (value = 0; value < phrases.length; value++) expect(exports.pickPortfolioTagline!()).toBe(phrases[value]);
  expect(maxima).toEqual([3, 3, 3]);
});

test("all 69 detail routes server-render one of the three exact taglines instead of the old paragraph", async ({ request }) => {
  const observed: { id: string; tagline: string }[] = [];
  for (const project of portfolioData) {
    const response = await request.get(`${basePath}/portfolio/${project.id}/`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    const match = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>\s*<p\b[^>]*>([^<]*)<\/p>/);
    expect(match, `${project.id} has a server-rendered paragraph beneath its title`).not.toBeNull();
    expect(phrases, project.id).toContain(match![1]);
    expect(html).not.toContain(oldText);
    observed.push({ id: project.id, tagline: match![1] });
  }
  expect(observed).toHaveLength(69);
  expect(new Set(observed.map((row) => row.id)).size).toBe(69);
});

for (const id of ["jd001", "jd038", "jd041"]) {
  test(`${id}: each response's server tagline survives hydration and theme changes; explicit static exports stay frozen on reload`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(`${basePath}/portfolio/${id}/`);
    const html = await response!.text();
    const match = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>\s*<p\b[^>]*>([^<]*)<\/p>/);
    expect(match).not.toBeNull();
    const tagline = page.locator("main h1 + p");
    await expect(tagline).toHaveCount(1);
    await expect(tagline).toHaveText(match![1]);
    expect(phrases).toContain(match![1]);
    const theme = page.getByRole("button", { name: "다크 모드로 전환", exact: true });
    await theme.click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(tagline).toHaveText(match![1]);
    const reloadResponse = await page.reload();
    expect(reloadResponse).not.toBeNull();
    expect(reloadResponse!.status()).toBe(200);
    const reloadHtml = await reloadResponse!.text();
    const reloadMatch = reloadHtml.match(/<h1\b[^>]*>[\s\S]*?<\/h1>\s*<p\b[^>]*>([^<]*)<\/p>/);
    expect(reloadMatch).not.toBeNull();
    expect(phrases).toContain(reloadMatch![1]);
    await expect(tagline).toHaveText(reloadMatch![1]);
    if (process.env.E2E_STATIC_EXPORT === "true") expect(reloadMatch![1]).toBe(match![1]);
    await expect(page.locator("main")).not.toContainText(oldText);
    expect(errors).toEqual([]);
  });
}
