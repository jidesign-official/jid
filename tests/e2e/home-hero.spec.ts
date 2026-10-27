import { test, expect } from "@playwright/test";
import fs from "node:fs";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

test("hero plays the supplied muted inline video without a text title", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`${basePath}/`);
  const hero = page.getByRole("region", { name: "JiD 소개 영상" });
  await expect(page.getByRole("heading", { name: "Turning imagination into reality", exact: true })).toHaveCount(0);
  const video = hero.locator("video");
  await expect(video).toHaveAttribute("src", `${basePath}/images/home/jiD.mp4`);
  await expect(video).toHaveAttribute("poster", `${basePath}/images/home/jiD-fallback.png`);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 2 && v.videoWidth === 1920 && v.muted && !v.loop && v.playsInline && !v.paused), { timeout: 15_000 }).toBe(true);
  const initial = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10_000 }).toBeGreaterThan(initial + 0.1);
  const response = await request.get(`${basePath}/images/home/jiD.mp4`);
  expect(response.status()).toBe(200);
  expect(await response.body()).toEqual(fs.readFileSync("public/images/home/jiD.mp4"));
  await expect(page.locator(".pin-spacer")).toHaveCount(0);
  await expect(hero.getByRole("button", { name: "영상 일시 정지" })).toBeVisible();
});

test("hero video stops on its final frame instead of looping", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`${basePath}/`);
  const video = page.locator("main video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 2 && v.duration > 0 && !v.loop), { timeout: 15_000 }).toBe(true);
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = Math.max(0, v.duration - 0.2);
    void v.play();
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.ended && v.paused), { timeout: 5_000 }).toBe(true);
  const finalTime = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await page.waitForTimeout(300);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(finalTime - 0.05);
  await expect(video).toHaveJSProperty("loop", false);
  await expect(page.getByRole("button", { name: "영상 재생", exact: true })).toBeVisible();
});

test("ended video stays stopped when motion preferences change until explicit play", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`${basePath}/`);
  const video = page.locator("main video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 2 && v.duration > 0 && !v.loop), { timeout: 15_000 }).toBe(true);
  await video.evaluate((v: HTMLVideoElement) => {
    v.currentTime = Math.max(0, v.duration - 0.2);
    void v.play();
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.ended && v.paused), { timeout: 5_000 }).toBe(true);
  const finalTime = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  const waitForMediaChange = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await waitForMediaChange();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await waitForMediaChange();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused && v.ended)).toBe(true);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(finalTime - 0.05);
  await page.getByRole("button", { name: "영상 재생", exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused && !v.ended)).toBe(true);
});

test("video playback can be paused and resumed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`${basePath}/`);
  const video = page.locator("main video");
  await page.getByRole("button", { name: "영상 일시 정지" }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.getByRole("button", { name: "영상 재생" }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
});

test("reduced motion leaves the supplied fallback image until the user explicitly plays", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${basePath}/`);
  const video = page.locator("main video");
  await expect(video).toHaveAttribute("poster", `${basePath}/images/home/jiD-fallback.png`);
  await expect(page.getByRole("button", { name: "영상 재생" })).toBeVisible();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused && v.currentTime === 0)).toBe(true);
  await page.getByRole("button", { name: "영상 재생" }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // Media-query changes are delivered during rendering; do not coalesce both
  // transitions into the same frame before testing the change listener.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
});

test("video pauses offscreen and resumes on return", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`${basePath}/`);
  const video = page.locator("main video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
});

test("video error after playback shows the supplied fallback image instead of the last frame", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`${basePath}/`);
  const hero = page.getByRole("region", { name: "JiD 소개 영상" });
  const video = hero.locator("video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 2 && !v.paused), { timeout: 15_000 }).toBe(true);
  const initial = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10_000 }).toBeGreaterThan(initial + 0.1);

  await video.evaluate((v: HTMLVideoElement) => v.dispatchEvent(new Event("error")));

  const poster = hero.locator("img");
  await expect(poster).toBeVisible();
  await expect(poster).toHaveAttribute("src", `${basePath}/images/home/jiD-fallback.png`);
  const expectedUrl = new URL(`${basePath}/images/home/jiD-fallback.png`, page.url()).href;
  const fallbackResponse = await request.get(`${basePath}/images/home/jiD-fallback.png`);
  expect(fallbackResponse.status()).toBe(200);
  expect(await fallbackResponse.body()).toEqual(fs.readFileSync("public/images/home/jiD-fallback.png"));
  await expect(poster.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    return { complete: img.complete, width: img.naturalWidth, height: img.naturalHeight, url: img.currentSrc };
  })).resolves.toEqual({ complete: true, width: 1920, height: 1080, url: expectedUrl });
  await expect(video).toBeHidden();
  await expect(page.getByRole("heading", { name: "Turning imagination into reality", exact: true })).toHaveCount(0);
  await expect(hero.getByRole("status")).toHaveText("영상을 재생할 수 없어 미리보기 이미지를 표시합니다.");
  await expect(hero.getByRole("button", { name: "영상 재생", exact: true })).toBeDisabled();
});

test("failed video keeps the accessible poster fallback without a text title", async ({ page }) => {
  await page.route("**/images/home/jiD.mp4", (route) => route.fulfill({ status: 404, body: "Missing video" }));
  await page.goto(`${basePath}/`);
  await expect(page.getByRole("heading", { name: "Turning imagination into reality" })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("영상을 재생할 수 없어");
  await expect(page.getByRole("button", { name: /영상 재생/ })).toBeDisabled();
});
