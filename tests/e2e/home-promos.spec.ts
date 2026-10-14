import { test, expect } from "@playwright/test";
import portfolioData from "../../public/images/portfolio/portfolio_data.json";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const featuredIds = ["jd003", "jd005_a", "jd026", "jd030"];

test("home cards show four real portfolio projects with working images", async ({ page }) => {
  await page.goto(`${basePath}/`);
  const cards = page.getByRole("region", { name: "3D 모델이 있는 대표 프로젝트", exact: true });
  await expect(cards.getByRole("link")).toHaveCount(4);
  await expect(cards.locator("h2")).toHaveCount(0);
  for (const id of featuredIds) {
    const project = portfolioData.find((item) => item.id === id)!;
    const link = cards.getByRole("link", { name: new RegExp(project.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    await expect(link).toHaveAttribute("href", `${basePath}/portfolio/${id}/`);
    await expect(link).not.toContainText("3D 모델 보기");
    await expect(link).not.toContainText("Product Design");
    const image = cards.getByRole("img", { name: project.title, exact: true });
    await expect(image).toHaveAttribute("src", `${basePath}${project.image}`);
    // WebKit does not fetch images far below the pinned hero until scrolled into view.
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  }
  await expect(page.locator('img[src*="_sample.jpg"]')).toHaveCount(0);
});

for (const width of [320, 390, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`featured thumbnails fill every card at ${width}px in ${theme} mode with images only and accessible links`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      const models: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => { if (/\.glb(?:\?|$)/i.test(request.url())) models.push(request.url()); });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
      // The existing toggle applies the root class on interaction, not from
      // storage initialization alone. Enter dark mode through the real control.
      await page.addInitScript(() => localStorage.setItem("theme", "light"));
      await page.goto(`${basePath}/`);
      if (theme === "dark") await page.getByRole("button", { name: "다크 모드로 전환", exact: true }).click();
      await expect.poll(() => page.locator("html").evaluate((element) => element.classList.contains("dark"))).toBe(theme === "dark");
      const grid = page.getByRole("region", { name: "3D 모델이 있는 대표 프로젝트", exact: true });
      await expect(grid.getByRole("link")).toHaveCount(4);
      for (const id of featuredIds) {
        const project = portfolioData.find((item) => item.id === id)!;
        const card = grid.getByRole("link", { name: `${project.title} 3D 모델 보기`, exact: true });
        await card.scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        const image = card.getByRole("img", { name: project.title, exact: true });
        await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
        await expect(image).toHaveCSS("object-fit", "cover");
        const [cardBox, imageBox] = await Promise.all([card.boundingBox(), image.boundingBox()]);
        expect(cardBox).not.toBeNull();
        expect(imageBox).not.toBeNull();
        for (const field of ["x", "y", "width", "height"] as const) {
          expect(imageBox![field], `${id} image ${field} equals full card ${field}`).toBeCloseTo(cardBox![field], 0);
        }
        expect(cardBox!.height).toBe(width >= 768 ? 580 : 500);
        await expect(card.locator('h2, p, span, [aria-hidden="true"]')).toHaveCount(0);
        expect((await card.textContent())?.trim()).toBe("");
        await expect(card).toHaveAttribute("href", `${basePath}/portfolio/${id}/`);
        await card.focus();
        // A mouse-clicked theme toggle leaves pointer modality active. Exercise
        // real keyboard traversal before asserting the focus-visible indicator.
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        await expect(card).toBeFocused();
        await expect(card).toHaveCSS("outline-style", "solid");
        await expect(card).toHaveCSS("outline-width", "2px");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(models).toEqual([]);
      expect(errors).toEqual([]);
      await grid.screenshot({ path: testInfo.outputPath(`full-bleed-featured-${width}-${theme}.png`) });
    });
  }
}

test("a full-image featured card still navigates to its unchanged project detail", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${basePath}/`);
  const project = portfolioData.find((item) => item.id === "jd003")!;
  const card = page.getByRole("region", { name: "3D 모델이 있는 대표 프로젝트", exact: true }).getByRole("link", { name: `${project.title} 3D 모델 보기`, exact: true });
  await card.click();
  await expect(page).toHaveURL(new RegExp(`${basePath}/portfolio/jd003/?$`));
  await expect(page.getByRole("heading", { level: 1, name: project.title, exact: true })).toBeVisible();
});
