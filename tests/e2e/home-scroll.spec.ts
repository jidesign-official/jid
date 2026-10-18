import { test, expect } from "@playwright/test";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

test("hero stays separate from product cards throughout normal and reverse scrolling", async ({ page }) => {
  await page.goto(`${basePath}/`);
  await expect(page.locator(".pin-spacer")).toHaveCount(0);
  const height = page.viewportSize()!.height;
  for (const fraction of [0.5, 0.9, 1.3, 1.9, 2.4, 1, 0]) {
    await page.evaluate((y) => window.scrollTo(0, y), height * fraction);
    await expect.poll(async () => page.evaluate(() => {
      const hero = document.querySelector("main section")!;
      const cards = document.querySelector('section[aria-label="대표 프로젝트"]')!;
      return cards.getBoundingClientRect().top - hero.getBoundingClientRect().bottom;
    }), { timeout: 3000 }).toBeGreaterThanOrEqual(-1);
  }
});

test("reduced motion keeps hero in normal flow with no scroll pinning", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`${basePath}/`);
  await expect(page.locator(".pin-spacer")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".pin-spacer")).toHaveCount(0);
  const hero = page.locator("main section").first();
  const cards = page.getByRole("region", { name: "대표 프로젝트" });
  await expect(hero.getByRole("heading", { level: 1 })).toBeVisible();
  const heroBox = await hero.boundingBox();
  const cardBox = await cards.boundingBox();
  expect(cardBox!.y).toBeGreaterThanOrEqual(heroBox!.y + heroBox!.height - 1);
  await cards.scrollIntoViewIfNeeded();
  await expect(cards.getByRole("link").first()).toBeVisible();
});

test("hero spacing remains correct after mobile and desktop resizing", async ({ page }) => {
  await page.goto(`${basePath}/`);
  await expect(page.locator(".pin-spacer")).toHaveCount(0);
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".pin-spacer")).toHaveCount(0);
    await page.evaluate((height) => window.scrollTo(0, height * 0.8), viewport.height);
    await expect.poll(() => page.evaluate(() => {
      const hero = document.querySelector("main section")!;
      const cards = document.querySelector('section[aria-label="대표 프로젝트"]')!;
      return cards.getBoundingClientRect().top - hero.getBoundingClientRect().bottom;
    }), { timeout: 5000 }).toBeGreaterThanOrEqual(-1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});
