import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

async function ready(page: Page) {
  await page.goto(`${basePath}/admin/`);
  const nav = page.getByRole("navigation", { name: "관리 도구 메뉴" });
  await nav.getByRole("button", { name: "프로젝트 목록" }).click();
  await expect(page.getByRole("heading", { name: "프로젝트 목록." })).toBeVisible();
  await nav.getByRole("button", { name: "편집기", exact: true }).click();
  await expect(page.getByLabel("프로젝트 ID", { exact: true })).toBeVisible();
}

async function contrast(target: Locator, background: string) {
  return target.evaluate((node, bg) => {
    const rgb = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const lum = (color: string) => rgb(color).map(v => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const a = lum(getComputedStyle(node).color), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, background);
}

test("admin brand displays the identical website logo asset, decoded and uncropped", async ({ page, request }) => {
  await ready(page);
  const brand = page.getByRole("link", { name: "JiD 홈페이지", exact: true });
  await expect(brand).toHaveAttribute("href", `${basePath}/`);
  const logo = brand.getByRole("img", { name: "JiD", exact: true });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src", `${basePath}/logo.png`);
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(logo).toHaveCSS("object-fit", "contain");
  await expect(logo).toHaveCSS("filter", "none");
  const ratio = await logo.evaluate((img: HTMLImageElement) => ({ original: img.naturalWidth / img.naturalHeight, rendered: img.width / img.height }));
  expect(ratio.rendered).toBeCloseTo(ratio.original, 1);
  const asset = await request.get(`${basePath}/logo.png`);
  expect(asset.status()).toBe(200);
  expect(createHash("sha256").update(await asset.body()).digest("hex")).toBe(createHash("sha256").update(readFileSync("public/logo.png")).digest("hex"));
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`Apple gallery stays intentionally light in ${colorScheme} preference with flat 28px surfaces and compact blue actions`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme });
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await ready(page);
    const shell = page.locator("[data-admin-shell]");
    await expect(shell).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(shell).toHaveCSS("color", "rgb(29, 29, 31)");
    await expect(shell).toHaveCSS("color-scheme", "light");
    const basic = page.locator("section").filter({ has: page.getByRole("heading", { name: "프로젝트 기본 정보", exact: true }) });
    await expect(basic).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(basic).toHaveCSS("border-radius", "28px");
    await expect(basic).toHaveCSS("box-shadow", "none");
    const stage = basic.locator("xpath=../../..");
    await expect(stage).toHaveCSS("background-color", "rgb(245, 245, 247)");
    const heading = page.getByRole("heading", { level: 1 }).first();
    await expect(heading).toHaveCSS("font-weight", "600");
    await expect(heading).toHaveCSS("font-size", "80px");
    const primary = page.getByRole("button", { name: "ZIP 내보내기", exact: true });
    await expect(primary).toHaveCSS("background-color", "rgb(0, 113, 227)");
    await expect(primary).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(primary).toHaveCSS("border-radius", "9999px");
    expect(await contrast(primary, "rgb(0, 113, 227)")).toBeGreaterThanOrEqual(4.5);
    const id = page.getByLabel("프로젝트 ID", { exact: true });
    await id.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(id).toHaveCSS("outline-color", "rgb(0, 102, 204)");
    expect(await contrast(basic.locator("small").first(), "rgb(255, 255, 255)")).toBeGreaterThanOrEqual(4.5);
    await page.getByRole("button", { name: "업로드 매뉴얼", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "업로드 매뉴얼", exact: true });
    await expect(dialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(dialog).toHaveCSS("color", "rgb(29, 29, 31)");
    await expect(dialog).toHaveCSS("border-radius", "28px");
    await expect(dialog).toHaveCSS("box-shadow", "none");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });
}

for (const width of [320, 768, 1440]) {
  test(`admin gallery ${width}px preserves all navigation and readable touch controls without overflow`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    const nav = page.getByRole("navigation", { name: "관리 도구 메뉴" });
    for (const label of ["프로젝트 목록", "게시 안내", "계정 · 권한", "편집기"]) {
      const button = nav.getByRole("button", { name: label, exact: true });
      await button.click();
      await expect(button).toHaveAttribute("aria-current", "page");
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    const id = page.getByLabel("프로젝트 ID", { exact: true });
    expect(await id.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
    const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "프로젝트 기본 정보", exact: true }) });
    await expect(card).toHaveCSS("border-radius", "28px");
    await page.getByRole("button", { name: "본문 블록 추가", exact: true }).click();
    await page.getByLabel("본문 내용").fill("원본 콘텐츠는 유지하고, 인터페이스만 새롭게.");
    await page.getByRole("button", { name: "전체 미리보기 ↗", exact: true }).click();
    await expect(page.getByRole("region", { name: "프로젝트 미리보기" })).toContainText("원본 콘텐츠는 유지하고, 인터페이스만 새롭게.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`admin-gallery-${width}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}
