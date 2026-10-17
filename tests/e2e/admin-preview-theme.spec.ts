import { ADMIN_PAGE_PATH } from "../helpers/admin-route";
import { test, expect, type Locator, type Page } from "@playwright/test";
import path from "node:path";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const title = "Admin preview theme regression";
const check = expect.configure({ soft: true, timeout: 200 });
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
  "base64",
);

async function setRootTheme(page: Page, dark: boolean) {
  // A stored preference alone does not exercise Tailwind's real dark selector.
  await page.evaluate((enabled) => document.documentElement.classList.toggle("dark", enabled), dark);
  expect(await page.locator("html").evaluate(node => node.classList.contains("dark"))).toBe(dark);
}

async function openModelPreview(page: Page, dark: boolean) {
  await page.goto(ADMIN_PAGE_PATH);
  const nav = page.getByRole("navigation", { name: "관리 도구 메뉴" });
  await nav.getByRole("button", { name: "프로젝트 목록", exact: true }).click();
  await expect(page.getByRole("heading", { name: "프로젝트 목록." })).toBeVisible();
  await nav.getByRole("button", { name: "편집기", exact: true }).click();
  await setRootTheme(page, dark);
  await page.getByLabel("프로젝트 제목", { exact: true }).fill(title);
  await page.getByLabel("대표 이미지 업로드").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png });
  await page.getByLabel("3D 모델 업로드").setInputFiles(path.join(process.cwd(), "public/images/glb/jd019_b_web.glb"));
  await expect(page.getByRole("button", { name: "ZIP 내보내기", exact: true })).toBeEnabled();
  await expect(page.getByText("jd019_b_web.glb", { exact: true })).toBeVisible();
  // The original viewer is lazy: leave it offscreen for CSS-only assertions.
  await page.evaluate(() => scrollTo(0, 0));
  await page.getByRole("button", { name: "전체 미리보기 ↗", exact: true }).click();
  await page.evaluate(() => scrollTo(0, 0));
  const preview = page.getByRole("region", { name: "프로젝트 미리보기", exact: true });
  const viewer = preview.getByRole("region", { name: `${title} 3D 모델`, exact: true });
  await expect(viewer).toBeAttached();
  return { preview, viewer };
}

async function contrast(target: Locator, background: string) {
  return target.evaluate((node, bg) => {
    // Canvas resolves CSS Color 4 lab()/color() and alpha to actual sRGB.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = bg;
    context.fillRect(0, 0, 1, 1);
    const back = Array.from(context.getImageData(0, 0, 1, 1).data);
    context.fillStyle = getComputedStyle(node).color;
    context.fillRect(0, 0, 1, 1);
    const fore = Array.from(context.getImageData(0, 0, 1, 1).data);
    const lum = (channels: number[]) => channels.slice(0, 3).map(v => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const a = lum(fore);
    const b = lum(back);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, background);
}

async function publicViewerStyles(page: Page, dark: boolean) {
  await page.goto(`${basePath}/portfolio/jd003/`);
  await setRootTheme(page, dark);
  const viewer = page.getByRole("region", { name: /3D 모델/ }).first();
  await expect(viewer).toBeAttached();
  return viewer.evaluate(node => {
    const heading = getComputedStyle(node.querySelector("h2")!);
    const stage = getComputedStyle(node.children[1]);
    return { color: heading.color, gradient: stage.backgroundImage, radius: stage.borderRadius, shadow: stage.boxShadow };
  });
}

for (const dark of [false, true]) {
  test(`valid GLB admin preview is a readable flat light gallery with actual html.${dark ? "dark" : "light"}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const publicBefore = await publicViewerStyles(page, dark);
    const { preview, viewer } = await openModelPreview(page, dark);
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const header = viewer.locator(":scope > div").first();
      const stage = viewer.locator(":scope > div").nth(1);
      const loading = viewer.getByRole("status");
      const toolbar = stage.locator(":scope > div").last();
      await check(viewer.getByRole("heading", { name: "3D 모델링 뷰어" })).toHaveCSS("color", "rgb(29, 29, 31)");
      check(await contrast(header.locator("p"), "rgb(255, 255, 255)"), `header contrast at ${width}px`).toBeGreaterThanOrEqual(4.5);
      await check(header).toHaveCSS("border-top-color", "rgb(214, 214, 214)");
      await check(stage).toHaveCSS("background-color", "rgb(245, 245, 247)");
      await check(stage).toHaveCSS("background-image", "none");
      await check(stage).toHaveCSS("border-radius", "28px");
      await check(stage).toHaveCSS("box-shadow", "none");
      await expect(loading).toBeAttached();
      await check(loading).toHaveCSS("background-color", "rgb(245, 245, 247)");
      await check(loading).toHaveCSS("backdrop-filter", "none");
      for (const p of await loading.locator("p").all()) {
        check(await contrast(p, "rgb(245, 245, 247)"), `loading contrast at ${width}px`).toBeGreaterThanOrEqual(4.5);
      }
      for (const button of await viewer.getByRole("button").all()) {
        const box = (await button.boundingBox())!;
        const stageBox = (await stage.boundingBox())!;
        check(box.width).toBeGreaterThanOrEqual(44);
        check(box.height).toBeGreaterThanOrEqual(44);
        check(box.x).toBeGreaterThanOrEqual(stageBox.x);
        check(box.x + box.width).toBeLessThanOrEqual(stageBox.x + stageBox.width + 1);
        check(await contrast(button, await button.evaluate(node => getComputedStyle(node).backgroundColor))).toBeGreaterThanOrEqual(4.5);
        await check(button).toHaveCSS("box-shadow", "none");
        await check(button).toHaveCSS("backdrop-filter", "none");
      }
      check(await toolbar.evaluate(node => node.scrollWidth <= node.clientWidth), `toolbar fits at ${width}px`).toBe(true);
      check(await preview.evaluate(node => node.scrollWidth <= node.clientWidth), `preview fits at ${width}px`).toBe(true);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator("html").evaluate(node => node.classList.contains("dark"))).toBe(dark);
    }
    // Leaving the workspace must not change the public viewer's own dark theme.
    await page.getByRole("navigation", { name: "관리 도구 메뉴" }).getByRole("button", { name: "프로젝트 목록", exact: true }).click();
    expect(await page.locator("html").evaluate(node => node.classList.contains("dark"))).toBe(dark);
    page.on("dialog", dialog => dialog.accept());
    await page.setViewportSize({ width: 1440, height: 900 });
    expect(await publicViewerStyles(page, dark)).toEqual(publicBefore);
  });
}

test("valid GLB preview capability fallback stays light and readable under actual html.dark", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (["webgl", "webgl2", "experimental-webgl"].includes(type)) return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.setViewportSize({ width: 320, height: 900 });
  const { viewer } = await openModelPreview(page, true);
  await viewer.scrollIntoViewIfNeeded();
  await expect(viewer).toHaveAttribute("data-state", "error");
  const alert = viewer.getByRole("alert");
  await check(alert).toHaveCSS("background-color", "rgb(245, 245, 247)");
  for (const p of await alert.locator("p").all()) {
    check(await contrast(p, "rgb(245, 245, 247)")).toBeGreaterThanOrEqual(4.5);
  }
  for (const button of await viewer.getByRole("button").all()) await expect(button).toBeDisabled();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

// Run this separate GPU case with the serial SwiftShader configuration, not the
// general cross-browser UI suite. Its inventory is explicitly opt-in.
if (process.env.ADMIN_PREVIEW_GPU === "1") {
test("loaded preview retains the real GLB renderer and readable blue rotation state", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const state = { target: null as HTMLCanvasElement | null, draws: new Map<HTMLCanvasElement, number>(), metrics: null as { pixels: number; colors: number; edgePixels: number; draws: number } | null };
    Object.assign(window, { adminPreviewFrame: state });
    const original = WebGL2RenderingContext.prototype.drawElements;
    WebGL2RenderingContext.prototype.drawElements = function (...args) {
      original.apply(this, args);
      const canvas = this.canvas as HTMLCanvasElement;
      state.draws.set(canvas, (state.draws.get(canvas) ?? 0) + 1);
      if (state.target !== canvas) return;
      state.target = null;
      queueMicrotask(() => {
        const width = this.drawingBufferWidth, height = this.drawingBufferHeight;
        const bytes = new Uint8Array(width * height * 4);
        this.readPixels(0, 0, width, height, this.RGBA, this.UNSIGNED_BYTE, bytes);
        let pixels = 0, edgePixels = 0;
        const colors = new Set<number>();
        for (let i = 0; i < bytes.length; i += 4) {
          if (bytes[i + 3] <= 16) continue;
          pixels++;
          colors.add((bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]);
          const index = i / 4, x = index % width, y = Math.floor(index / width);
          if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edgePixels++;
        }
        state.metrics = { pixels, colors: colors.size, edgePixels, draws: state.draws.get(canvas) ?? 0 };
      });
    };
  });
  await page.setViewportSize({ width: 320, height: 900 });
  const { viewer } = await openModelPreview(page, true);
  await viewer.scrollIntoViewIfNeeded();
  await expect(viewer).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  await expect(viewer.locator("canvas")).toHaveCount(1);
  await viewer.locator("canvas").evaluate(canvas => {
    const state = (window as unknown as { adminPreviewFrame: { target: HTMLCanvasElement } }).adminPreviewFrame;
    state.target = canvas as HTMLCanvasElement;
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { adminPreviewFrame: { metrics: unknown } }).adminPreviewFrame.metrics)).not.toBeNull();
  const metrics = await page.evaluate(() => (window as unknown as { adminPreviewFrame: { metrics: { pixels: number; colors: number; edgePixels: number; draws: number } } }).adminPreviewFrame.metrics);
  expect(metrics.draws).toBeGreaterThan(0);
  expect(metrics.pixels).toBeGreaterThan(500);
  expect(metrics.colors).toBeGreaterThan(20);
  expect(metrics.edgePixels).toBe(0);
  await testInfo.attach("admin-preview-framebuffer", { body: JSON.stringify(metrics), contentType: "application/json" });
  await viewer.screenshot({ path: testInfo.outputPath("admin-preview-rendered.png") });
  const rotate = viewer.getByRole("button", { name: /자동 회전/ });
  await expect(rotate).toHaveAttribute("aria-pressed", "true");
  await expect(rotate).toHaveCSS("background-color", "rgb(0, 102, 204)");
  await expect(rotate).toHaveCSS("color", "rgb(255, 255, 255)");
  expect(await contrast(rotate, "rgb(0, 102, 204)")).toBeGreaterThanOrEqual(4.5);
  await rotate.click();
  await page.mouse.move(0, 0);
  await expect(rotate).toHaveAttribute("aria-pressed", "false");
  await expect(rotate).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(rotate).toHaveCSS("color", "rgb(29, 29, 31)");
  expect(await viewer.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
});
}
