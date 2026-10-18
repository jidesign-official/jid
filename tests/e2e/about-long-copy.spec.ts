import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";

const nativeRequire = createRequire(__filename);
const contentApi: typeof import("../../src/lib/aboutContent") = nativeRequire("../../src/lib/aboutContent.ts");
const aboutPath = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/about/`;

// Controlled layout tests: use the real public DOM/CSS, changing only text nodes.
// Publication/SSR is covered separately; these tests never edit the root JSON.
function stressCopy() {
  const content = contentApi.createDefaultAboutContent();
  content.headings = { eyebrow: "e".repeat(120), philosophy: "f".repeat(120), history: "h".repeat(120), services: "s".repeat(120) };
  content.introduction = { title: "T".repeat(240), subtitle: "x".repeat(500), paragraph: "p".repeat(6000) };
  content.philosophy[0] = { ...content.philosophy[0], title: "F".repeat(240), subtitle: "u".repeat(500), paragraph: "q".repeat(6000) };
  content.history[0].events[0] = "v".repeat(1000);
  content.services[0] = { name: "S".repeat(240), description: "d".repeat(2000) };
  content.links = { portfolioLabel: "P".repeat(120), contactLabel: "C".repeat(120) };
  // The exact maxima and their aggregate encoded size must be genuinely valid.
  return contentApi.parseAboutContent(contentApi.serializeAboutContent(content));
}

for (const width of [320, 390, 768, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`valid unbroken edited copy wraps without clipping at ${width}px in ${theme}`, async ({ page, context }, testInfo) => {
      const content = stressCopy();
      const origin = new URL(testInfo.project.use.baseURL ?? "http://localhost:3000").origin;
      await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
      await page.goto(aboutPath, { waitUntil: "networkidle" });
      await page.evaluate((value) => document.documentElement.classList.toggle("dark", value === "dark"), theme);
      const about = page.getByRole("article", { name: "About JiD", exact: true });
      await expect(about).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

      // First isolate the verified regression: only a valid 500-character subtitle.
      const subtitle = about.locator('[aria-labelledby="about-introduction"] > p[lang="ko"]').first();
      await subtitle.evaluate((element, value) => { element.textContent = value; }, content.introduction.subtitle);
      const isolated = await subtitle.evaluate((element) => ({
        document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth,
        scroll: element.scrollWidth, client: element.clientWidth, wrap: getComputedStyle(element).overflowWrap,
      }));
      expect(isolated.document, JSON.stringify(isolated)).toBeLessThanOrEqual(isolated.viewport);
      expect(isolated.scroll, JSON.stringify(isolated)).toBeLessThanOrEqual(isolated.client);

      const edits = [
        ['[aria-labelledby="about-introduction"] > p[lang="en"]', content.headings.eyebrow],
        ["#about-introduction", content.introduction.title],
        ['[aria-labelledby="about-introduction"] > p[lang="ko"]:last-of-type', content.introduction.paragraph],
        ["#about-philosophy", content.headings.philosophy],
        ["#about-history", content.headings.history],
        ["#about-services", content.headings.services],
        ['[aria-labelledby="about-philosophy"] h3', content.philosophy[0].title],
        ['[aria-labelledby="about-philosophy"] section p:first-of-type', content.philosophy[0].subtitle],
        ['[aria-labelledby="about-philosophy"] section p:last-of-type', content.philosophy[0].paragraph],
        ['[aria-labelledby="about-history"] ul > li', content.history[0].events[0]],
        ['[aria-labelledby="about-services"] dt', content.services[0].name],
        ['[aria-labelledby="about-services"] dd', content.services[0].description],
      ];
      for (const [selector, value] of edits) {
        const element = about.locator(selector).first();
        await element.evaluate((node, copy) => { node.textContent = copy; }, value);
        await expect(element).toHaveText(value);
      }
      for (const [index, value] of Object.values(content.links).entries()) {
        const link = about.locator("nav a").nth(index);
        // Retain the real arrow, aria-hidden, href and flex-item structure.
        await link.evaluate((element, copy) => { element.firstChild!.textContent = `${copy} `; }, value);
        await expect(link).toContainText(value);
      }
      const layout = await about.evaluate((article) => {
        const viewport = document.documentElement.clientWidth;
        const nodes = [...article.querySelectorAll("p,h1,h2,h3,li,dt,dd,nav a")];
        return {
          viewport, document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
          overflowing: nodes.flatMap((node) => {
            const element = node as HTMLElement;
            const bounds = element.getBoundingClientRect();
            return bounds.left < 0 || bounds.right > viewport || element.scrollWidth > element.clientWidth
              ? [{ tag: element.tagName, left: bounds.left, right: bounds.right, scroll: element.scrollWidth, client: element.clientWidth }]
              : [];
          }),
          clipped: [article, ...nodes].filter((element) => {
            const style = getComputedStyle(element);
            return ["hidden", "clip", "scroll", "auto"].includes(style.overflowX) || style.textOverflow === "ellipsis";
          }).map((element) => element.tagName),
        };
      });
      expect(layout.document, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport);
      expect(layout.body, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport);
      expect(layout.overflowing).toEqual([]);
      expect(layout.clipped, "long copy must wrap, not disappear behind clipping/scroll containers").toEqual([]);
      for (const link of await about.locator("nav a").all()) {
        const box = await link.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
      }
      expect(await about.locator("nav a").evaluateAll((links) => links.map((link) => link.getAttribute("href"))))
        .toEqual([`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/portfolio/`, `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/contact/`]);
    });
  }
}
