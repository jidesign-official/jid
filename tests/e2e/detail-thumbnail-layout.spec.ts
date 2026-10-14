import { test, expect } from "@playwright/test";
import portfolioData from "../../public/images/portfolio/portfolio_data.json";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Independent catalog identity fixture: do not derive route coverage from the page
// or its generateStaticParams implementation (which could omit an entry).
const catalogIds = [
  "jd001", "jd002", "jd003", "jd004_a", "jd004_b", "jd005_a", "jd005_b",
  "jd006", "jd007", "jd008_a", "jd008_b", "jd008_c", "jd008_d", "jd008_e",
  "jd008_f", "jd008_g", "jd008_h", "jd009", "jd010", "jd011", "jd012",
  "jd013", "jd014", "jd015_a", "jd015_b", "jd015_c", "jd016", "jd017_a",
  "jd017_b", "jd017_c", "jd017_d", "jd017_e", "jd017_f", "jd017_g",
  "jd018_a", "jd018_b", "jd018_c", "jd019_a", "jd019_b", "jd020", "jd021",
  "jd022", "jd023", "jd024_a", "jd024_b", "jd025_aa", "jd025_ab",
  "jd025_b", "jd025_c", "jd026", "jd027", "jd028", "jd029", "jd030",
  "jd033", "jd034_a", "jd034_b", "jd034_c", "jd035", "jd036", "jd037",
  "jd038", "jd039", "jd040", "jd041", "jd042", "jd043", "jd044", "jd045",
];
const optimizedIds = new Set([
  "jd037", "jd038", "jd039", "jd040", "jd041", "jd042", "jd043", "jd044", "jd045",
]);

function originalThumbnailSource(id: string) {
  return optimizedIds.has(id)
    ? `/images/portfolio/optimized/${id}/${id}_thumbs.webp`
    : `/images/portfolio/${id}/${id}_thumbs.png`;
}

function escapedAttribute(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;",
  })[character]!);
}

function attribute(tag: string, name: string) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

test("all 69 registered HTTP detail routes retain their first thumbnail sources with a 1024px square cap", async ({ request }, testInfo) => {
  test.setTimeout(90_000);
  expect(catalogIds).toHaveLength(69);
  expect(new Set(catalogIds).size).toBe(69);
  expect(portfolioData.map(({ id }) => id).sort()).toEqual([...catalogIds].sort());

  const observed: { id: string; source: string | undefined; classes: string[] }[] = [];
  for (const id of catalogIds) {
    const project = portfolioData.find((item) => item.id === id)!;
    const source = `${basePath}${originalThumbnailSource(id)}`;
    expect(project.image, `${id}: original metadata thumbnail`).toBe(originalThumbnailSource(id));
    const response = await request.get(`${basePath}/portfolio/${id}/`);
    expect(response.status(), `${id}: actual exported route registration`).toBe(200);
    const html = await response.text();
    expect(html, `${id}: route-specific title`).toContain(`<title>${escapedAttribute(project.title)} - JiD</title>`);

    // Inspect actual SSR markup, not RSC serialized strings or gallery images.
    const frames = [...html.matchAll(/<div\b[^>]*class="([^"]*\baspect-square\b[^"]*)"[^>]*>\s*(<img\b[^>]*>)/g)]
      .filter(([, , image]) => attribute(image, "src") === source);
    expect(frames, `${id}: unique main metadata thumbnail frame`).toHaveLength(1);
    const [, frameClass, image] = frames[0];
    const classes = frameClass.split(/\s+/);
    observed.push({ id, source: attribute(image, "src"), classes });
    expect(attribute(image, "alt"), `${id}: original thumbnail title`).toBe(escapedAttribute(project.title));
    expect(classes).toEqual(expect.arrayContaining(["w-full", "mx-auto", "aspect-square", "overflow-hidden"]));
    expect(attribute(image, "class")?.split(/\s+/)).toEqual(expect.arrayContaining(["w-full", "h-full", "object-contain"]));
    expect.soft(classes, `${id}: first thumbnail max-width`).toContain("max-w-[1024px]");
    expect.soft(classes, `${id}: obsolete first thumbnail cap`).not.toContain("max-w-[768px]");
  }
  expect(observed).toHaveLength(portfolioData.length);
  expect(new Set(observed.map(({ id }) => id)).size).toBe(catalogIds.length);
  await testInfo.attach("all-route-thumbnail-layout", {
    body: JSON.stringify(observed, null, 2), contentType: "application/json",
  });
});

// Legacy PNG, new optimized PNG-source thumbnail, and the JPEG-source jd038
// sequence project. All other routes are covered above without 69 GPU sessions.
for (const id of ["jd002", "jd037", "jd038"]) {
  for (const width of [1440, 320, 390]) {
    test(`${id}: decoded first thumbnail fills available width at ${width}px without cropping or overflow`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(`${basePath}/portfolio/${id}/`, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(200);
      const project = portfolioData.find((item) => item.id === id)!;
      const source = `${basePath}${originalThumbnailSource(id)}`;
      const image = page.locator(`main img[src="${source}"]`);
      await expect(image).toHaveCount(1);
      await expect(image).toHaveAttribute("alt", project.title);
      await image.evaluate(async (node: HTMLImageElement) => { await node.decode(); });
      await page.evaluate(() => document.fonts.ready);

      const layout = await image.evaluate((node: HTMLImageElement) => {
        const frame = node.parentElement!;
        const container = frame.parentElement!;
        const bounds = frame.getBoundingClientRect();
        const imageBounds = node.getBoundingClientRect();
        const containerBounds = container.getBoundingClientRect();
        return {
          complete: node.complete, naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight,
          source: node.getAttribute("src"), currentSource: node.currentSrc,
          width: bounds.width, height: bounds.height, left: bounds.left, right: bounds.right,
          imageWidth: imageBounds.width, imageHeight: imageBounds.height,
          availableWidth: containerBounds.width, containerLeft: containerBounds.left, containerRight: containerBounds.right,
          maxWidth: getComputedStyle(frame).maxWidth, aspectRatio: getComputedStyle(frame).aspectRatio,
          objectFit: getComputedStyle(node).objectFit, overflow: getComputedStyle(frame).overflow,
          scrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth,
        };
      });
      await testInfo.attach("decoded-thumbnail-layout", {
        body: JSON.stringify(layout, null, 2), contentType: "application/json",
      });
      expect(layout.complete).toBe(true);
      expect(layout.naturalWidth).toBeGreaterThan(0);
      expect(layout.naturalHeight).toBeGreaterThan(0);
      expect(layout.source).toBe(source);
      expect(new URL(layout.currentSource).pathname).toBe(source);
      const expectedWidth = Math.min(1024, width - (width >= 768 ? 64 : 32));
      expect(layout.availableWidth).toBeCloseTo(expectedWidth, 1);
      expect(layout.width).toBeCloseTo(expectedWidth, 1);
      expect(layout.height).toBeCloseTo(layout.width, 1);
      expect(layout.imageWidth).toBeCloseTo(layout.width, 1);
      expect(layout.imageHeight).toBeCloseTo(layout.height, 1);
      expect(layout.left).toBeCloseTo(layout.containerLeft, 1);
      expect(layout.right).toBeCloseTo(layout.containerRight, 1);
      expect(layout.maxWidth).toBe("1024px");
      expect(layout.aspectRatio).toBe("1 / 1");
      expect(layout.objectFit).toBe("contain");
      expect(layout.overflow).toBe("hidden");
      expect(layout.left).toBeGreaterThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
    });
  }
}
