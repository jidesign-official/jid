import { test, expect, type Page, type Download } from "@playwright/test";
import { ADMIN_PAGE_PATH } from "../helpers/admin-route";
import type { AboutContent } from "../../src/lib/aboutContent";

test.setTimeout(45_000);
test.use({ actionTimeout: 5_000 });
const editor = (page: Page) => page.locator("[data-about-editor]");
const source = (page: Page) => editor(page).getByLabel("About HTML 소스", { exact: true });
const mode = (page: Page, name: "에디터" | "HTML") => editor(page).getByRole("tab", { name, exact: true });
const menu = (page: Page) => page.getByRole("navigation", { name: "관리 도구 메뉴" });
async function openEditor(page: Page) {
  await page.goto(ADMIN_PAGE_PATH);
  await menu(page).getByRole("button", { name: "프로젝트 목록", exact: true }).click();
  await expect(page.getByRole("heading", { name: "프로젝트 목록.", exact: true })).toBeVisible();
  await menu(page).getByRole("button", { name: "About Us 편집", exact: true }).click();
  await expect(editor(page).getByRole("heading", { name: "About Us 편집.", exact: true })).toBeVisible();
}
async function exported(page: Page): Promise<{ value: AboutContent; text: string; download: Download }> {
  const pending = page.waitForEvent("download");
  await editor(page).getByRole("button", { name: "About JSON 내보내기", exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("about-content.json");
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Missing actual browser download stream");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  expect(bytes.byteLength).toBeLessThanOrEqual(64 * 1024);
  const text = bytes.toString("utf8");
  const value = JSON.parse(text) as AboutContent;
  expect(text).toBe(`${JSON.stringify(value, null, 2)}\n`);
  return { value, text, download };
}
async function importText(page: Page, text: string, name = "about-content.json") {
  await editor(page).getByLabel("About JSON 가져오기", { exact: true }).setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(text) });
}
function confirmNext(page: Page, accept: boolean) {
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    if (accept) await dialog.accept(); else await dialog.dismiss();
  });
}

test("synchronized HTML exports the current source candidate and reflects both editing directions", async ({ page }, testInfo) => {
  const writes: string[] = [];
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
  await openEditor(page);
  await expect(mode(page, "에디터")).toHaveAttribute("aria-selected", "true");
  await expect(source(page)).toHaveCount(0);
  const initial = (await exported(page)).value;
  const formTitle = "HTML QA form → source & entities";
  await editor(page).getByLabel("소개 제목", { exact: true }).fill(formTitle);
  await mode(page, "HTML").click();
  await expect(mode(page, "HTML")).toHaveAttribute("aria-selected", "true");
  await expect(editor(page).getByLabel("소개 제목", { exact: true })).toHaveCount(0);
  const canonical = await source(page).inputValue();
  expect(canonical).toContain('data-about-document="1"');
  expect(canonical).toContain('HTML QA form → source &amp; entities');
  const title = "HTML QA source → editor <literal> & value";
  const paragraph = '  First HTML line\nSecond line\t<img src=x onerror="window.aboutHtmlInjected=true">  ';
  const escaped = '  First HTML line\nSecond line\t&lt;img src=x onerror="window.aboutHtmlInjected=true"&gt;  ';
  const edited = canonical.replace('HTML QA form → source &amp; entities', 'HTML QA source → editor &lt;literal&gt; &amp; value')
    .replace(/(<p data-about-field="paragraph">)[\s\S]*?(<\/p>)/, `$1${escaped}$2`);
  await source(page).fill(edited);
  // Download before switching modes: stale structured content must never win.
  const result = await exported(page);
  expect(result.value).toEqual({ ...initial, introduction: { ...initial.introduction, title, paragraph } });
  const artifactPath = testInfo.outputPath("about-content.json");
  await result.download.saveAs(artifactPath);
  await testInfo.attach("actual-html-edited-browser-export", { path: artifactPath, contentType: "application/json" });
  await expect(editor(page).getByText("게시되지 않은 About 변경", { exact: true })).toBeVisible();
  await mode(page, "에디터").click();
  await expect(editor(page).getByLabel("소개 제목", { exact: true })).toHaveValue(title);
  await expect(editor(page).getByLabel("소개 본문", { exact: true })).toHaveValue(paragraph);
  await mode(page, "HTML").click();
  expect((await exported(page)).value).toEqual(result.value);
  expect(await page.evaluate(() => (window as unknown as { aboutHtmlInjected?: boolean }).aboutHtmlInjected)).toBeUndefined();
  await expect(editor(page).locator("script,img,iframe,style")).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("switching representations and equivalent JSON key order never create a false unsaved change", async ({ page }) => {
  await openEditor(page);
  const initial = (await exported(page)).value;
  await mode(page, "HTML").click();
  await mode(page, "에디터").click();
  await expect(editor(page).getByText("현재 게시된 About 내용", { exact: true })).toBeVisible();
  await expect(page.locator("[data-admin-shell] header").getByText("● 저장하지 않은 변경", { exact: true })).toBeHidden();
  const reordered: Record<string, unknown> = Object.fromEntries(Object.entries(initial).reverse());
  reordered.introduction = Object.fromEntries(Object.entries(initial.introduction).reverse());
  await importText(page, JSON.stringify(reordered));
  await expect(editor(page)).toHaveAttribute("aria-busy", "false");
  await expect(editor(page).getByText("현재 게시된 About 내용", { exact: true })).toBeVisible();
  await mode(page, "HTML").click();
  await mode(page, "에디터").click();
  await expect(editor(page).getByText("현재 게시된 About 내용", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(false);
});

test("HTML list edits preserve exact IDs, source order and empty section headings", async ({ page }, testInfo) => {
  await openEditor(page);
  const initial = (await exported(page)).value;
  await mode(page, "HTML").click();
  const canonical = await source(page).inputValue();
  const philosophy = [
    { id: "source-second", title: "Second source idea", subtitle: "Second subtitle", paragraph: "  Second paragraph\nnext line  " },
    { id: "source-first", title: "First source idea", subtitle: "First subtitle", paragraph: "First paragraph" },
  ];
  const edited = canonical
    .replace(/(<section data-about-section="philosophy">\s*<h2>[\s\S]*?<\/h2>)[\s\S]*?(?=\n  <section data-about-section="history">)/, `$1\n${philosophy.map((item) => `    <section data-about-id="${item.id}"><h3>${item.title}</h3><p data-about-field="subtitle">${item.subtitle}</p><p data-about-field="paragraph">${item.paragraph}</p></section>`).join("\n")}\n  </section>`)
    .replace(/(<section data-about-section="history">\s*<h2>[\s\S]*?<\/h2>)[\s\S]*?(?=\n  <section data-about-section="services">)/, '$1\n    <ol><li><time>2031</time><ul><li>Second event first</li><li>First event second</li></ul></li><li><time>2029</time><ul><li>Earlier year</li></ul></li></ol>\n  </section>')
    .replace(/(<section data-about-section="services">\s*<h2>[\s\S]*?<\/h2>)[\s\S]*?(?=\n<\/article>)/, '$1\n    <dl><div><dt>Source service B</dt><dd>Description B</dd></div><div><dt>Source service A</dt><dd>Description A</dd></div></dl>\n  </section>');
  await source(page).fill(edited);
  const expected = { ...initial, philosophy, history: [{ year: "2031", events: ["Second event first", "First event second"] }, { year: "2029", events: ["Earlier year"] }], services: [{ name: "Source service B", description: "Description B" }, { name: "Source service A", description: "Description A" }] };
  const listExport = await exported(page);
  expect(listExport.value).toEqual(expected);
  const listPath = testInfo.outputPath("about-content.json");
  await listExport.download.saveAs(listPath);
  await testInfo.attach("actual-html-list-browser-export", { path: listPath, contentType: "application/json" });
  await mode(page, "에디터").click();
  await expect(editor(page).locator("[data-philosophy-id]").first()).toHaveAttribute("data-philosophy-id", "source-second");
  await expect(editor(page).getByLabel("철학 1 본문", { exact: true })).toHaveValue(philosophy[0].paragraph);
  await expect(editor(page).getByLabel("연혁 1 연도", { exact: true })).toHaveValue("2031");
  await expect(editor(page).getByLabel("서비스 1 이름", { exact: true })).toHaveValue("Source service B");
  const empty = { ...initial, philosophy: [], history: [], services: [] };
  confirmNext(page, true);
  await importText(page, JSON.stringify(empty));
  await expect(editor(page).getByRole("button", { name: "철학 1 삭제", exact: true })).toHaveCount(0);
  await mode(page, "HTML").click();
  const emptyExport = await exported(page);
  expect(emptyExport.value).toEqual(empty);
  const emptyPath = testInfo.outputPath("about-content-empty.json");
  await emptyExport.download.saveAs(emptyPath);
  await testInfo.attach("actual-html-empty-browser-export", { path: emptyPath, contentType: "application/json" });
  expect(await source(page).inputValue()).toContain(`<h2>${initial.headings.philosophy}</h2>`);
  await mode(page, "에디터").click();
  expect((await exported(page)).value).toEqual(empty);
});

test("JSON-only Unicode stays editable and exportable until a guarded HTML conversion is attempted", async ({ page }) => {
  await openEditor(page);
  const initial = (await exported(page)).value;
  const jsonOnly = { ...initial, introduction: { ...initial.introduction, paragraph: "Preserve lone surrogate: \ud800" } };
  await importText(page, JSON.stringify(jsonOnly));
  await expect(editor(page)).toHaveAttribute("aria-busy", "false");
  expect((await exported(page)).value).toEqual(jsonOnly);
  await expect(editor(page).getByRole("alert")).toHaveCount(0);
  await mode(page, "HTML").click();
  await expect(mode(page, "에디터")).toHaveAttribute("aria-selected", "true");
  await expect(source(page)).toHaveCount(0);
  await expect(editor(page).getByRole("alert")).toContainText("현재 편집 내용은 유지됩니다");
  expect((await exported(page)).value).toEqual(jsonOnly);
});

test("mode conversion stays independent from the canonical JSON export byte budget", async ({ page }) => {
  await openEditor(page);
  const original = (await exported(page)).value;
  const large: AboutContent = { ...original, introduction: { ...original.introduction, paragraph: "&".repeat(6000) }, philosophy: [], services: [], history: Array.from({ length: 100 }, (_, index) => ({ year: String(1000 + index), events: ["&".repeat(530)] })) };
  expect(Buffer.byteLength(JSON.stringify(large))).toBeLessThanOrEqual(64 * 1024);
  expect(Buffer.byteLength(`${JSON.stringify(large, null, 2)}\n`)).toBeGreaterThan(64 * 1024);
  await importText(page, JSON.stringify(large));
  await expect(editor(page)).toHaveAttribute("aria-busy", "false");
  await expect(editor(page).getByRole("button", { name: "About JSON 내보내기", exact: true })).toBeDisabled();
  await mode(page, "HTML").click();
  await expect(mode(page, "HTML")).toHaveAttribute("aria-selected", "true");
  const html = await source(page).inputValue();
  expect(Buffer.byteLength(html)).toBeGreaterThan(64 * 1024);
  expect(Buffer.byteLength(html)).toBeLessThanOrEqual(512 * 1024);
  await mode(page, "에디터").click();
  await expect(mode(page, "에디터")).toHaveAttribute("aria-selected", "true");
  await expect(editor(page).getByLabel("소개 본문", { exact: true })).toHaveValue(large.introduction.paragraph);
  await mode(page, "HTML").click();
  await source(page).fill(html.replace(/(<p data-about-field="paragraph">)[\s\S]*?(<\/p>)/, "$1Reduced paragraph$2"));
  expect((await exported(page)).value).toEqual({ ...large, introduction: { ...large.introduction, paragraph: "Reduced paragraph" } });
});

test("invalid HTML stays raw, inert, dirty and blocks switching or stale export", async ({ page }) => {
  await openEditor(page);
  const initial = (await exported(page)).value;
  await mode(page, "HTML").click();
  const canonical = await source(page).inputValue();
  const unsafe = [
    canonical.replace("</article>", '<script>window.aboutHtmlInjected=true</script></article>'),
    canonical.replace('<article ', '<article onclick="window.aboutHtmlInjected=true" '),
    canonical.replace("</article>", '<style>body{display:none}</style></article>'),
    canonical.replace('href="/portfolio"', 'href="javascript:window.aboutHtmlInjected=true"'),
    canonical.replace("</article>", '<img src="https://invalid.example/about-html-probe" onerror="window.aboutHtmlInjected=true"></article>'),
    canonical.replace("</article>", ""),
    canonical.replace("data-about-section=\"history\"", "data-about-section=\"unknown\""),
    canonical.replace(/(<h1 data-about-field="title">)[\s\S]*?(<\/h1>)/, "$1<strong>Unsupported rich text</strong>$2"),
  ];
  const unexpected: string[] = [];
  page.on("request", (request) => { if (request.url().includes("invalid.example")) unexpected.push(request.url()); });
  for (const raw of unsafe) {
    await source(page).fill(raw);
    await expect(editor(page).getByRole("button", { name: "About JSON 내보내기", exact: true })).toBeDisabled();
    await mode(page, "에디터").click();
    await expect(mode(page, "HTML")).toHaveAttribute("aria-selected", "true");
    await expect(source(page)).toHaveValue(raw);
    await expect(editor(page).getByRole("alert")).toContainText("현재 편집 내용은 유지됩니다");
    await expect(editor(page).getByText("게시되지 않은 About 변경", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(true);
    await expect(editor(page).locator("script,img,iframe,style,strong[onclick]")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { aboutHtmlInjected?: boolean }).aboutHtmlInjected)).toBeUndefined();
  }
  expect(unexpected).toEqual([]);
  await source(page).fill(canonical);
  await mode(page, "에디터").click();
  expect((await exported(page)).value).toEqual(initial);
});

test("incomplete structured entries block HTML conversion without resetting fields", async ({ page }) => {
  await openEditor(page);
  const originalTitle = await editor(page).getByLabel("소개 제목", { exact: true }).inputValue();
  await editor(page).getByRole("button", { name: "철학 추가", exact: true }).click();
  const index = await editor(page).locator("[data-philosophy-id]").count();
  const id = await editor(page).locator("[data-philosophy-id]").last().getAttribute("data-philosophy-id");
  await mode(page, "HTML").click();
  await expect(mode(page, "에디터")).toHaveAttribute("aria-selected", "true");
  await expect(source(page)).toHaveCount(0);
  await expect(editor(page).getByLabel("소개 제목", { exact: true })).toHaveValue(originalTitle);
  await expect(editor(page).getByLabel(`철학 ${index} 제목`, { exact: true })).toHaveValue("");
  await expect(editor(page).getByRole("alert")).toContainText("현재 편집 내용은 유지됩니다");
  await editor(page).getByLabel(`철학 ${index} 제목`, { exact: true }).fill("New idea");
  await editor(page).getByLabel(`철학 ${index} 부제`, { exact: true }).fill("New subtitle");
  await editor(page).getByLabel(`철학 ${index} 본문`, { exact: true }).fill("New paragraph");
  await mode(page, "HTML").click();
  expect(await source(page).inputValue()).toContain(`data-about-id="${id}"`);
  await mode(page, "에디터").click();
  await expect(editor(page).locator("[data-philosophy-id]").last()).toHaveAttribute("data-philosophy-id", id!);
});

test("pending raw HTML survives global tabs and guarded JSON imports; reset isolates other drafts", async ({ page }) => {
  await openEditor(page);
  const published = (await exported(page)).value;
  await mode(page, "HTML").click();
  const original = await source(page).inputValue();
  const raw = `${original}<script>window.aboutHtmlInjected=true</script>`;
  await source(page).fill(raw);
  for (const tab of ["프로젝트 목록", "게시 안내", "계정 · 권한", "편집기"]) {
    await menu(page).getByRole("button", { name: tab, exact: true }).click();
    await expect(page.locator("[data-admin-shell] header").getByText("● 저장하지 않은 변경", { exact: true })).toBeVisible();
  }
  await page.getByLabel("프로젝트 제목", { exact: true }).fill("Separate project draft");
  await menu(page).getByRole("button", { name: "About Us 편집", exact: true }).click();
  await expect(source(page)).toHaveValue(raw);
  await importText(page, "{");
  await expect(editor(page).getByRole("alert")).toContainText("현재 편집 내용은 유지됩니다");
  await expect(source(page)).toHaveValue(raw);
  const replacement = { ...published, introduction: { ...published.introduction, title: "Imported over pending source" } };
  confirmNext(page, false);
  await importText(page, JSON.stringify(replacement));
  await expect(editor(page)).toHaveAttribute("aria-busy", "false");
  await expect(source(page)).toHaveValue(raw);
  confirmNext(page, true);
  await importText(page, JSON.stringify(replacement));
  await expect(source(page)).toHaveValue(/Imported over pending source/);
  expect((await exported(page)).value).toEqual(replacement);
  await mode(page, "에디터").click();
  await expect(editor(page).getByLabel("소개 제목", { exact: true })).toHaveValue(replacement.introduction.title);
  await mode(page, "HTML").click();
  const imported = await source(page).inputValue();
  await source(page).fill(`${imported}<script>bad</script>`);
  confirmNext(page, false);
  await editor(page).getByRole("button", { name: "현재 게시된 내용으로 되돌리기", exact: true }).click();
  await expect(source(page)).toHaveValue(`${imported}<script>bad</script>`);
  confirmNext(page, true);
  await editor(page).getByRole("button", { name: "현재 게시된 내용으로 되돌리기", exact: true }).click();
  expect((await exported(page)).value).toEqual(published);
  await expect(editor(page).getByText("현재 게시된 About 내용", { exact: true })).toBeVisible();
  await mode(page, "HTML").click();
  await expect(source(page)).toHaveValue(original);
  await expect(page.locator("[data-admin-shell] header").getByText("● 저장하지 않은 변경", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(true);
  await menu(page).getByRole("button", { name: "편집기", exact: true }).click();
  await expect(page.getByLabel("프로젝트 제목", { exact: true })).toHaveValue("Separate project draft");
});

test("HTML import locks source and both mode tabs for the entire async read", async ({ page }) => {
  await openEditor(page);
  const published = (await exported(page)).value;
  await mode(page, "HTML").click();
  const original = await source(page).inputValue();
  await page.evaluate(() => {
    const read = File.prototype.text;
    const state = window as unknown as { htmlReads: number; releaseHtmlRead?: () => void };
    state.htmlReads = 0;
    File.prototype.text = function () {
      state.htmlReads++;
      if (this.name === "slow.json") return new Promise<string>((resolve) => {
        state.releaseHtmlRead = () => { void read.call(this).then(resolve); };
      });
      return read.call(this);
    };
  });
  await importText(page, " ".repeat(64 * 1024 + 1));
  await expect(editor(page).getByRole("alert")).toContainText("64KiB");
  expect(await page.evaluate(() => (window as unknown as { htmlReads: number }).htmlReads)).toBe(0);
  const replacement = { ...published, introduction: { ...published.introduction, title: "Slow JSON candidate" } };
  await importText(page, JSON.stringify(replacement), "slow.json");
  await expect(editor(page)).toHaveAttribute("aria-busy", "true");
  for (const control of [source(page), mode(page, "에디터"), mode(page, "HTML"), editor(page).getByLabel("About JSON 가져오기", { exact: true }), editor(page).getByRole("button", { name: "About JSON 내보내기", exact: true }), editor(page).getByRole("button", { name: "현재 게시된 내용으로 되돌리기", exact: true })]) await expect(control).toBeDisabled();
  await mode(page, "에디터").dispatchEvent("click");
  await expect(mode(page, "HTML")).toHaveAttribute("aria-selected", "true");
  await expect(source(page)).toHaveValue(original);
  await editor(page).getByLabel("About JSON 가져오기", { exact: true }).evaluate((input, text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], "competing.json", { type: "application/json" }));
    (input as HTMLInputElement).files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, JSON.stringify(published));
  expect(await page.evaluate(() => (window as unknown as { htmlReads: number }).htmlReads)).toBe(1);
  // Leaving the global tab must not unmount/cancel the owner or lose its source.
  await menu(page).getByRole("button", { name: "게시 안내", exact: true }).click();
  await page.evaluate(() => (window as unknown as { releaseHtmlRead: () => void }).releaseHtmlRead());
  await menu(page).getByRole("button", { name: "About Us 편집", exact: true }).click();
  await expect(editor(page)).toHaveAttribute("aria-busy", "false");
  await expect(source(page)).toHaveValue(/Slow JSON candidate/);
  expect((await exported(page)).value).toEqual(replacement);
  // Existing import errors survive successful export until a successful import/reset.
  await importText(page, "{");
  await expect(editor(page).getByRole("alert")).toContainText("가져오지 못했습니다");
  expect((await exported(page)).value).toEqual(replacement);
  await expect(editor(page).getByRole("alert")).toBeVisible();
});

test("HTML mode remains light at 320px under actual root dark and supports keyboard tabs", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openEditor(page);
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(page.locator("html")).toHaveClass(/dark/);
  await mode(page, "에디터").focus();
  await page.keyboard.press("ArrowRight");
  await expect(mode(page, "HTML")).toBeFocused();
  await expect(source(page)).toBeVisible();
  await expect(editor(page).getByRole("tabpanel")).toHaveCount(1);
  const metrics = await editor(page).evaluate((root) => ({
    background: getComputedStyle(root).backgroundColor,
    color: getComputedStyle(root).color,
    scheme: getComputedStyle(root).colorScheme,
    overflow: document.documentElement.scrollWidth > innerWidth,
    source: [...root.querySelectorAll("textarea")].map((node) => ({ font: parseFloat(getComputedStyle(node).fontSize), family: getComputedStyle(node).fontFamily, height: node.getBoundingClientRect().height, width: node.getBoundingClientRect().width, background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color })),
    controls: [...root.querySelectorAll<HTMLElement>('button,a,label:has(input[type="file"])')].map((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })),
  }));
  expect(metrics.background).toBe("rgb(255, 255, 255)");
  expect(metrics.color).toBe("rgb(29, 29, 31)");
  expect(metrics.scheme).toBe("light");
  expect(metrics.overflow).toBe(false);
  expect(metrics.source).toHaveLength(1);
  for (const input of metrics.source) {
    expect(input.font).toBeGreaterThanOrEqual(16);
    expect(input.family).toMatch(/monospace/);
    expect(input.height).toBeGreaterThanOrEqual(420);
    expect(input.width).toBeGreaterThan(0);
    expect(input.background).toBe("rgb(255, 255, 255)");
    expect(input.color).toBe("rgb(29, 29, 31)");
  }
  for (const control of metrics.controls) { expect(control.width).toBeGreaterThanOrEqual(44); expect(control.height).toBeGreaterThanOrEqual(44); }
  await page.keyboard.press("Home");
  await expect(mode(page, "에디터")).toBeFocused();
  await expect(source(page)).toHaveCount(0);
  await expect(page.locator("footer")).toHaveCount(0);
});

test("selected mode tabs retain readable contrast on hover and pointer-away in light and actual root dark", async ({ page }, testInfo) => {
  await openEditor(page);
  const published = (await exported(page)).text;
  const observations: unknown[] = [];
  const readStyle = async (tab: ReturnType<typeof mode>) => tab.evaluate(async (node) => {
    // Let real hover transitions start and finish before sampling computed colors.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await Promise.all(node.getAnimations().map((animation) => animation.finished));
    const style = getComputedStyle(node);
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return { color: style.color, background: style.backgroundColor, border: style.borderTopColor,
      contrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
      hovered: node.matches(":hover"), outlineColor: style.outlineColor, outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset };
  });
  for (const dark of [false, true]) {
    await page.evaluate((enabled) => document.documentElement.classList.toggle("dark", enabled), dark);
    expect(await page.locator("html").evaluate((root) => root.classList.contains("dark"))).toBe(dark);
    for (const name of ["에디터", "HTML"] as const) {
      const selected = mode(page, name);
      const unselected = mode(page, name === "HTML" ? "에디터" : "HTML");
      await selected.click();
      await selected.focus();
      await page.keyboard.press(name === "HTML" ? "End" : "Home");
      await expect(selected).toHaveAttribute("aria-selected", "true");
      await expect(selected).toBeFocused();
      for (const hovered of [true, false]) {
        if (hovered) await selected.hover(); else await page.mouse.move(0, 0);
        const style = await readStyle(selected);
        const label = `${dark ? "dark" : "light"} selected ${name} ${hovered ? "hover" : "pointer-away"}`;
        observations.push({ label, ...style });
        expect(style.hovered, label).toBe(hovered);
        expect.soft(style.contrast, `${label}: ${JSON.stringify(style)}`).toBeGreaterThanOrEqual(4.5);
        expect.soft(style.background, label).toBe("rgb(29, 29, 31)");
        expect.soft(style.color, label).toBe("rgb(255, 255, 255)");
        expect(style.outlineColor, label).toBe("rgb(0, 102, 204)");
        expect(style.outlineStyle, label).toBe("solid");
        expect(style.outlineWidth, label).toBe("3px");
        expect(style.outlineOffset, label).toBe("3px");
      }
      await expect(unselected).toHaveAttribute("aria-selected", "false");
      for (const hovered of [true, false]) {
        if (hovered) await unselected.hover(); else await page.mouse.move(0, 0);
        const style = await readStyle(unselected);
        expect(style.hovered).toBe(hovered);
        expect(style.background).toBe(hovered ? "rgb(245, 245, 247)" : "rgb(255, 255, 255)");
        expect(style.color).toBe("rgb(29, 29, 31)");
        expect(style.contrast).toBeGreaterThanOrEqual(4.5);
      }
      // Exercise real async-import disabled state, including a selected hovered tab.
      await page.evaluate(() => {
        const state = window as unknown as { releaseHoverRead?: () => void };
        const read = File.prototype.text;
        File.prototype.text = function () {
          File.prototype.text = read;
          return new Promise<string>((resolve) => {
            state.releaseHoverRead = () => { void read.call(this).then(resolve); };
          });
        };
      });
      await importText(page, published, "hover-controls.json");
      await expect(editor(page)).toHaveAttribute("aria-busy", "true");
      for (const tab of [selected, unselected]) {
        await expect(tab).toBeDisabled();
        for (const hovered of [true, false]) {
          if (hovered) await tab.hover({ force: true }); else await page.mouse.move(0, 0);
          const style = await readStyle(tab);
          expect(style.hovered).toBe(hovered);
          expect(style.background).toBe("rgb(238, 238, 240)");
          expect(style.border).toBe("rgb(214, 214, 220)");
          expect(style.color).toBe("rgb(115, 115, 121)");
        }
      }
      await page.evaluate(() => (window as unknown as { releaseHoverRead: () => void }).releaseHoverRead());
      await expect(editor(page)).toHaveAttribute("aria-busy", "false");
    }
  }
  await testInfo.attach("selected-mode-tab-computed-contrast", { body: JSON.stringify(observations, null, 2), contentType: "application/json" });
});
