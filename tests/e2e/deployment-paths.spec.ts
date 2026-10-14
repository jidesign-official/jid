import { test, expect } from "@playwright/test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function configuration(env: Record<string, string>) {
  const compiled = ts.transpileModule(fs.readFileSync("next.config.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: { default?: { basePath: string; output: string } } = {};
  vm.runInNewContext(compiled, { exports, process: { env } });
  return exports.default!;
}

test("GitHub Actions defaults to the custom-domain root without an old repository prefix", () => {
  expect(configuration({ GITHUB_ACTIONS: "true" })).toMatchObject({ basePath: "", output: "export" });
  expect(configuration({ GITHUB_ACTIONS: "true", NEXT_PUBLIC_BASE_PATH: "" }).basePath).toBe("");
});

test("an explicit repository prefix still supports a separate project-site build", () => {
  expect(configuration({ GITHUB_ACTIONS: "true", NEXT_PUBLIC_BASE_PATH: "/jid" }).basePath).toBe("/jid");
});

test("the deployed root serves its real stylesheet, logo, poster and navigation destinations", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto(`${basePath}/`);
  expect(response?.status()).toBe(200);
  const assets = await page.evaluate(() => [
    ...Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).map((node) => node.href),
    document.querySelector<HTMLImageElement>("header img")?.src,
    document.querySelector<HTMLVideoElement>("video")?.poster,
  ].filter((value): value is string => Boolean(value)));
  expect(assets.length).toBeGreaterThanOrEqual(3);
  for (const asset of assets) {
    expect(new URL(asset).pathname.startsWith(`${basePath}/`)).toBe(true);
    if (basePath === "") expect(new URL(asset).pathname).not.toMatch(/^\/(?:jid|jdesign)\//);
    const result = await request.get(asset);
    expect(result.status(), asset).toBe(200);
    expect((await result.body()).length, asset).toBeGreaterThan(0);
  }
  for (const route of ["about", "portfolio", "contact", "contact/thanks"]) {
    const result = await request.get(`${basePath}/${route}/`);
    expect(result.status(), route).toBe(200);
  }
  expect(errors).toEqual([]);
});
