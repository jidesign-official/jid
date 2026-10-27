import { test, expect } from "@playwright/test";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

for (const width of [320, 390, 430, 600, 767, 768, 1440]) {
  test(`hero media and playback control remain usable (${width}px)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${basePath}/`, { waitUntil: "domcontentloaded" });
    const hero = page.getByRole("region", { name: "JiD 소개 영상" });
    await expect(page.getByRole("heading", { name: "Turning imagination into reality" })).toHaveCount(0);
    await expect(hero.locator("video")).toBeVisible();
    const button = hero.getByRole("button", { name: "영상 재생", exact: true });
    await expect(button).toBeVisible();
    const [h, b] = await Promise.all([hero.boundingBox(), button.boundingBox()]);
    expect(h && b).toBeTruthy();
    const rightInset = h!.x + h!.width - b!.x - b!.width;
    const bottomInset = h!.y + h!.height - b!.y - b!.height;
    expect(rightInset).toBeGreaterThanOrEqual(0);
    expect(rightInset).toBeLessThanOrEqual(32);
    expect(bottomInset).toBeGreaterThanOrEqual(0);
    expect(bottomInset).toBeLessThanOrEqual(24);
    expect(b!.width).toBeGreaterThanOrEqual(44);
    expect(b!.height).toBeGreaterThanOrEqual(44);
    const appearance = await button.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, background: s.backgroundColor, border: s.borderTopWidth, opacity: s.opacity };
    });
    expect(appearance).toEqual({ color: "rgb(255, 255, 255)", background: "rgba(0, 0, 0, 0)", border: "0px", opacity: "0.65" });
    const icon = await button.locator("svg").boundingBox();
    expect(icon?.width).toBe(18);
    expect(icon?.height).toBe(18);
    await button.focus();
    expect(await button.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
    await button.evaluate((el: HTMLButtonElement) => el.blur());
    await hero.screenshot({ path: testInfo.outputPath(`hero-without-title-${width}.png`) });
  });
}

test("mobile control remains usable when the fallback status appears", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${basePath}/`, { waitUntil: "domcontentloaded" });
  const hero = page.getByRole("region", { name: "JiD 소개 영상" });
  const playButton = hero.getByRole("button", { name: "영상 재생", exact: true });
  await playButton.click();
  const pauseButton = hero.getByRole("button", { name: "영상 일시 정지", exact: true });
  await expect(pauseButton).toBeVisible();
  await pauseButton.click();
  await expect(playButton).toBeVisible();
  await expect.poll(() => hero.locator("video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
  await hero.locator("video").dispatchEvent("error");
  await expect(hero.getByRole("status")).toBeVisible();
  await expect(hero.getByRole("heading", { name: "Turning imagination into reality" })).toHaveCount(0);
  const button = hero.getByRole("button", { name: "영상 재생", exact: true });
  await expect(button).toBeDisabled();
  const [h, b] = await Promise.all([hero.boundingBox(), button.boundingBox()]);
  expect(h && b).toBeTruthy();
  expect(h!.x + h!.width - b!.x - b!.width).toBeGreaterThanOrEqual(0);
  expect(h!.y + h!.height - b!.y - b!.height).toBeGreaterThanOrEqual(0);
});
