import { test, expect } from "@playwright/test";

// Independent oracle: preserve the user's exact route token, not a derived slug.
const path = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/vhxmvhffldhdjqfhemrkdlem/`;
const prefix = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

test("requested editor route is present in raw HTML with search exclusion before JavaScript", async ({ page, request }) => {
  const response = await request.get(path);
  expect(response.status()).toBe(200);
  const html = await response.text();
  const head = html.split(/<\/head>/i)[0];
  for (const name of ["robots", "googlebot"]) {
    const tag = head.match(new RegExp(`<meta\\b[^>]*name=["']${name}["'][^>]*>`, "i"))?.[0];
    expect(tag, `${name} is in the server-rendered head`).toBeDefined();
    for (const rule of ["noindex", "nofollow", "nosnippet", "noimageindex"]) expect(tag).toContain(rule);
  }
  await page.goto(path);
  await expect(page.locator("[data-admin-shell]")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Global Navigation" })).toHaveCount(0);
  await expect(page.locator("footer")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "JiD 홈페이지", exact: true }).getByRole("img", { name: "JiD", exact: true })).toBeVisible();
});

test("retired admin URLs return real 404 responses and never reveal or redirect to the replacement", async ({ request }) => {
  for (const oldPath of ["/admin", "/admin/", "/admin.html", "/admin/index.html"]) {
    const response = await request.get(`${prefix}${oldPath}`, { maxRedirects: 0 });
    expect(response.status(), oldPath).toBe(404);
    expect(response.headers()["location"]).toBeUndefined();
    expect(await response.text()).not.toContain("vhxmvhffldhdjqfhemrkdlem");
  }
});

test("public pages and discovery files do not advertise the relocated editor or inherit its noindex", async ({ request }) => {
  for (const publicPath of ["/", "/about/", "/portfolio/", "/contact/"]) {
    const response = await request.get(`${prefix}${publicPath}`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map(match => match[1]);
    expect(hrefs.some(href => href.includes("vhxmvhffldhdjqfhemrkdlem") || /^\/admin(?:\/|$)/.test(href))).toBe(false);
    const robots = html.split(/<\/head>/i)[0].match(/<meta\b[^>]*name=["']robots["'][^>]*>/i)?.[0];
    if (robots) expect(robots).not.toContain("noindex");
  }
  // Do not publish the obscure address in robots.txt; crawlers must be able to
  // read the page's noindex rather than being blocked before seeing it.
  for (const discovery of ["/robots.txt", "/sitemap.xml"]) {
    const response = await request.get(`${prefix}${discovery}`);
    expect([200, 404]).toContain(response.status());
    expect(await response.text()).not.toContain("vhxmvhffldhdjqfhemrkdlem");
  }
});

test("existing origin-scoped browser drafts survive the editor path change", async ({ page }) => {
  await page.goto(`${prefix}/admin/`);
  const title = "Preserved draft across URL change";
  await page.evaluate(async draftTitle => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("jid-public-editor-v1", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("drafts")) request.result.createObjectStore("drafts", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").put({
        id: "route-migration-draft", title: draftTitle, projectId: "jd046", updatedAt: Date.now(),
        manifest: { schemaVersion: 1, project: { id: "jd046", title: draftTitle, category: "Product", thumbnail: "" }, blocks: [], models: [], assets: [] }, files: [],
      });
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, title);
  await page.goto(path);
  await page.getByRole("button", { name: `초안 불러오기 ${title}`, exact: true }).click();
  await expect(page.getByLabel("프로젝트 제목", { exact: true })).toHaveValue(title);
  await expect(page.getByLabel("프로젝트 ID", { exact: true })).toHaveValue("jd046");
});
