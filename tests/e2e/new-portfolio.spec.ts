import { test, expect } from "@playwright/test";
import portfolioData from "../../public/images/portfolio/portfolio_data.json";
import { modelProjects } from "./helpers/model-cases";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const additions = [
  ["jd037", "ACTILINK TRIO_PLASMAPP"],
  ["jd038", "STER SUTTLE_PLASMAPP"],
  ["jd039", "STERLINK Lite Plus_PLASMAPP"],
  ["jd040", "STERLINK Mini_PLASMAPP"],
  ["jd041", "STERLINK Pro_PLASMAPP"],
  ["jd042", "STERLINK Ultra_PLASMAPP"],
  ["jd043", "Wonder Ray_LICHTZEN"],
  ["jd044", "3D Printer_Ray"],
  ["jd045", "Air Sterilizer_PLASMAPP"],
];

test("registers the nine supplied projects with the exact workbook titles without losing existing entries", () => {
  expect(portfolioData).toHaveLength(69);
  expect(new Set(portfolioData.map((project) => project.id)).size).toBe(69);
  for (const [id, title] of additions) {
    expect(portfolioData.find((project) => project.id === id)).toMatchObject({ id, folder: id, title, category: "Product" });
  }
});

for (const [id, title] of additions) {
  test(`${id}: new detail route has its title, decoded thumbnail, gallery and ordered model regions`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${basePath}/portfolio/${id}/`);
    await expect(page).toHaveTitle(`${title} - JiD`);
    await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toHaveCount(1);
    const thumbnail = page.getByRole("img", { name: title, exact: true });
    await expect(thumbnail).toHaveCount(1);
    await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(page.getByRole("heading", { name: "프로젝트 상세 시안", exact: true })).toHaveCount(1);
    const files = modelProjects.find((project) => project.id === id)?.files ?? [];
    await expect(page.getByRole("region", { name: /3D 모델$/ })).toHaveCount(files.length);
    await expect(page.getByRole("link", { name: "프로젝트 문의하기", exact: false })).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

for (const width of [320, 375]) {
  for (const id of ["jd006", "jd041", "jd038"]) {
    test(`${id}: previous/next navigation fits a ${width}px screen without title overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${basePath}/portfolio/${id}/`);
      await page.evaluate(() => document.fonts.ready);
      const navigation = page.getByRole("link", { name: /이전 프로젝트|다음 프로젝트/ });
      await expect(navigation).toHaveCount(id === "jd038" ? 1 : 2);
      for (const link of await navigation.all()) {
        const box = await link.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        await expect(link).toHaveAttribute("href", /\/portfolio\/jd/);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
}

for (const id of ["jd004_a", "jd004_b"]) {
  test(`${id}: three additional original images are included and decode in the existing gallery`, async ({ page }) => {
    await page.goto(`${basePath}/portfolio/${id}/`);
    for (const index of [3, 4, 5]) {
      const image = page.locator(`img[src="${basePath}/images/portfolio/${id}/${id}_${index}.png"]`);
      await expect(image).toHaveCount(1);
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
    }
  });
}
