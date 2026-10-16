import { test, expect } from "@playwright/test";
import catalog from "../../public/images/portfolio/portfolio_data.json";
import titles from "./fixtures/portfolio-titles.json";
import { modelProjects } from "./helpers/model-cases";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const expectedTitles: Record<string, string> = titles;

// Fixture is a snapshot of the supplied workbook D column, not generated from
// production catalog titles. Preserve spelling, punctuation and trailing spaces.
test("all existing catalog names exactly match the workbook D column without adding unpublished rows", () => {
  expect(catalog).toHaveLength(69);
  expect(Object.keys(titles)).toHaveLength(69);
  expect(catalog.map(({ id }) => id).sort()).toEqual(Object.keys(titles).sort());
  for (const project of catalog) expect(project.title, project.id).toBe(expectedTitles[project.id]);
  expect(catalog.some(({ id }) => id === "jd031" || id === "jd032")).toBe(false);
});

test("all 69 exported detail headings, metadata, thumbnail alt and model names use exact new names", async ({ request, page }, testInfo) => {
  test.setTimeout(120_000);
  const observed: string[] = [];
  for (const [id, title] of Object.entries(titles)) {
    const response = await request.get(`${basePath}/portfolio/${id}/`);
    expect(response.status(), id).toBe(200);
    const state = await page.evaluate((html) => {
      const document = new DOMParser().parseFromString(html, "text/html");
      return {
        heading: document.querySelector("main h1")?.textContent,
        title: document.querySelector("title")?.textContent,
        browserTitle: document.title,
        description: document.querySelector('meta[name="description"]')?.getAttribute("content"),
        alt: document.querySelector("main img")?.getAttribute("alt"),
        viewers: Array.from(document.querySelectorAll('main section[aria-label]'))
          .map((node) => node.getAttribute("aria-label")!).filter((name) => name.endsWith(" 3D 모델")),
      };
    }, await response.text());
    expect(state.heading, id).toBe(title);
    expect(state.title, id).toBe(`${title} - JiD`);
    // HTML's document.title getter collapses ASCII whitespace for display;
    // raw <title>, heading, alt and ARIA values still preserve the workbook.
    expect(state.browserTitle, id).toBe(`${title} - JiD`.replace(/[\t\n\f\r ]+/g, " ").trim());
    expect(state.description, id).toBe(`${title} 제품 디자인 포트폴리오 상세 페이지입니다.`);
    expect(state.alt, id).toBe(title);
    const files = modelProjects.find((project) => project.id === id)?.files ?? [];
    expect(state.viewers, id).toEqual(files.map((_, index) => `${title}${files.length > 1 ? ` — 모델 ${index + 1}` : ""} 3D 모델`));
    observed.push(id);
  }
  expect(new Set(observed).size).toBe(69);
  await testInfo.attach("renamed-route-coverage", { body: JSON.stringify(observed), contentType: "application/json" });
});

test("all four portfolio pagination pages display the new names while retaining every original route", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${basePath}/portfolio/`);
  const seen = new Set<string>();
  for (let number = 1; number <= 4; number++) {
    const links = page.locator(`main a[href^="${basePath}/portfolio/jd"]`);
    const before = await links.first().getAttribute("href");
    for (const card of await links.all()) {
      const href = (await card.getAttribute("href"))!;
      const id = href.split("/").filter(Boolean).at(-1)!;
      expect(seen.has(id), `duplicate ${id}`).toBe(false);
      expect(Object.hasOwn(titles, id)).toBe(true);
      expect(await card.locator("h3").textContent()).toBe(expectedTitles[id]);
      await expect(card.locator("img")).toHaveAttribute("alt", expectedTitles[id]);
      seen.add(id);
    }
    if (number < 4) {
      await page.getByRole("button", { name: String(number + 1), exact: true }).click();
      await expect(links.first()).not.toHaveAttribute("href", before!);
    }
  }
  expect([...seen].sort()).toEqual(Object.keys(titles).sort());
});

test("homepage cards follow the four requested project URLs in exact order with image-only presentation", async ({ page }) => {
  await page.goto(`${basePath}/`);
  const ids = ["jd025_c", "jd008_b", "jd005_b", "jd013"];
  const grid = page.getByRole("region", { name: "3D 모델이 있는 대표 프로젝트", exact: true });
  const cards = grid.getByRole("link");
  await expect(cards).toHaveCount(4);
  expect(await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href"))))
    .toEqual(ids.map((id) => `${basePath}/portfolio/${id}/`));
  for (const [index, id] of ids.entries()) {
    const card = cards.nth(index);
    await expect(card).toHaveAttribute("aria-label", `${expectedTitles[id]} 3D 모델 보기`);
    await expect(card.locator("img")).toHaveAttribute("alt", expectedTitles[id]);
    await expect(card.locator("h2, p, span")).toHaveCount(0);
    expect((await card.textContent())?.trim()).toBe("");
  }
});

for (const width of [320, 390, 1440]) {
  test(`new long project names fit the ${width}px detail viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const id of ["jd013", "jd008_e", "jd003", "jd015_a"]) {
      await page.goto(`${basePath}/portfolio/${id}/`);
      await page.evaluate(() => document.fonts.ready);
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toHaveText(expectedTitles[id]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), id).toBeLessThanOrEqual(width);
      const bounds = (await heading.boundingBox())!;
      expect(bounds.x, id).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width, id).toBeLessThanOrEqual(width);
    }
  });
}
