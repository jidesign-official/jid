import { test, expect, type Page, type Download } from "@playwright/test";
import { ADMIN_PAGE_PATH } from "../helpers/admin-route";

// Independent publication oracle: do not import the implementation's defaults/parser.
const CURRENT_FOUR = ["jd025_c", "jd008_b", "jd005_b", "jd013"];
type Settings = { schemaVersion: number; order: string[]; hidden: string[]; featured: string[] };
test.setTimeout(20_000);

async function openManager(page: Page) {
  await page.goto(ADMIN_PAGE_PATH);
  await page.getByRole("navigation", { name: "관리 도구 메뉴" }).getByRole("button", { name: "프로젝트 목록" }).click();
  await expect(page.getByRole("heading", { name: "프로젝트 목록.", exact: true })).toBeVisible();
  // This fails on the old read-only catalog only AFTER a real hydrated tab click.
  await expect(page.getByRole("heading", { name: "메인 대표 항목", exact: true })).toBeVisible();
}
const manager = (page: Page) => page.locator("[data-portfolio-manager]");
const row = (page: Page, id: string) => manager(page).locator(`[data-project-id="${id}"]`);
const catalogIds = (page: Page) => manager(page).locator("[data-project-id]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-project-id")!));
const featuredIds = (page: Page) => manager(page).locator("[data-featured-project-id]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-featured-project-id")!));
async function readDownload(download: Download): Promise<{ text: string; value: Settings }> {
  expect(download.suggestedFilename()).toBe("portfolio-settings.json");
  const stream = await download.createReadStream();
  if (!stream) throw new Error("The browser did not produce a download stream");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  expect(bytes.length).toBeLessThanOrEqual(64 * 1024);
  const text = bytes.toString("utf8");
  const value = JSON.parse(text) as Settings;
  expect(Object.keys(value)).toEqual(["schemaVersion", "order", "hidden", "featured"]);
  expect(value.schemaVersion).toBe(1);
  expect(new Set(value.order).size).toBe(value.order.length);
  expect(new Set(value.hidden).size).toBe(value.hidden.length);
  expect(new Set(value.featured).size).toBe(4);
  expect(value.featured).toHaveLength(4);
  for (const id of [...value.order, ...value.hidden, ...value.featured]) expect(id).toMatch(/^jd[0-9]{3}(?:_[a-z]+)?$/);
  for (const id of value.featured) {
    expect(value.order).toContain(id);
    expect(value.hidden).not.toContain(id);
  }
  expect(text).toBe(`${JSON.stringify(value, null, 2)}\n`);
  return { text, value };
}
async function exported(page: Page) {
  const download = page.waitForEvent("download");
  await manager(page).getByRole("button", { name: "설정 JSON 내보내기", exact: true }).click();
  return readDownload(await download);
}
async function importText(page: Page, text: string) {
  await manager(page).getByLabel("설정 JSON 가져오기", { exact: true }).setInputFiles({ name: "portfolio-settings.json", mimeType: "application/json", buffer: Buffer.from(text) });
}
function dialog(page: Page, accept: boolean, message?: RegExp) {
  const result = page.waitForEvent("dialog");
  page.once("dialog", async (d) => {
    if (message) expect(d.message()).toMatch(message);
    if (accept) await d.accept(); else await d.dismiss();
  });
  return result;
}

test("baseline RED: current four are selected and homepage order is independent", async ({ page }) => {
  await openManager(page);
  expect(await featuredIds(page)).toEqual(CURRENT_FOUR);
  await expect(manager(page).getByRole("checkbox", { checked: true })).toHaveCount(4);
  for (const id of CURRENT_FOUR) await expect(row(page, id).getByRole("checkbox")).toBeChecked();
  const baseline = await catalogIds(page);
  const unselected = baseline.find((id) => !CURRENT_FOUR.includes(id))!;
  await expect(row(page, unselected).getByRole("checkbox")).toBeDisabled();
  await manager(page).locator(`[data-featured-project-id="${CURRENT_FOUR[0]}"]`).getByRole("button", { name: `${CURRENT_FOUR[0]} 메인 아래로`, exact: true }).click();
  const mainOrder = [CURRENT_FOUR[1], CURRENT_FOUR[0], ...CURRENT_FOUR.slice(2)];
  expect(await featuredIds(page)).toEqual(mainOrder);
  expect(await catalogIds(page)).toEqual(baseline);
  await row(page, baseline[0]).getByRole("button", { name: `${baseline[0]} 목록 아래로`, exact: true }).click();
  const newOrder = [baseline[1], baseline[0], ...baseline.slice(2)];
  expect(await catalogIds(page)).toEqual(newOrder);
  expect(await featuredIds(page)).toEqual(mainOrder);
  const result = await exported(page);
  expect(result.value).toEqual({ schemaVersion: 1, order: newOrder, hidden: [], featured: mainOrder });
  await expect(manager(page).getByText("게시되지 않은 목록 변경", { exact: true })).toBeVisible();
});

test("baseline RED: exclusion requires confirmation, blocks export, and restores position", async ({ page }) => {
  await openManager(page);
  const before = await catalogIds(page);
  const id = CURRENT_FOUR[0];
  const cancel = dialog(page, false, /메인.*해제|대표.*해제/);
  await row(page, id).getByRole("button", { name: "게시 제외", exact: true }).click();
  await cancel;
  await expect(row(page, id).getByRole("checkbox")).toBeChecked();
  await expect(manager(page).getByRole("button", { name: "설정 JSON 내보내기" })).toBeEnabled();
  const accept = dialog(page, true, /4개|네 개/);
  await row(page, id).getByRole("button", { name: "게시 제외", exact: true }).click();
  await accept;
  await expect(row(page, id).getByRole("checkbox")).not.toBeChecked();
  await expect(row(page, id).getByRole("checkbox")).toBeDisabled();
  await expect(row(page, id).getByText("게시 제외", { exact: true })).toBeVisible();
  await expect(manager(page).getByRole("button", { name: "설정 JSON 내보내기" })).toBeDisabled();
  expect(await catalogIds(page)).toEqual(before);
  const replacement = before.find((item) => !CURRENT_FOUR.includes(item))!;
  await row(page, replacement).getByRole("checkbox").check();
  expect((await exported(page)).value.hidden).toEqual([id]);
  await row(page, id).getByRole("button", { name: "복원", exact: true }).click();
  expect(await catalogIds(page)).toEqual(before);
  await expect(row(page, id).getByRole("checkbox")).not.toBeChecked();
  expect((await exported(page)).value.hidden).toEqual([]);
});

test("baseline RED: invalid imports preserve draft and valid import normalizes partial order", async ({ page }) => {
  await openManager(page);
  const baseline = (await exported(page)).value;
  await row(page, baseline.order[0]).getByRole("button", { name: `${baseline.order[0]} 목록 아래로`, exact: true }).click();
  const draft = (await exported(page)).value;
  const invalid = [
    "{",
    JSON.stringify({ ...baseline, extra: true }),
    JSON.stringify({ ...baseline, schemaVersion: "1" }),
    JSON.stringify({ ...baseline, order: ["JD038"] }),
    JSON.stringify({ ...baseline, order: ["jd999"] }),
    JSON.stringify({ ...baseline, order: [baseline.order[0], baseline.order[0]] }),
    JSON.stringify({ ...baseline, hidden: [CURRENT_FOUR[0]] }),
    JSON.stringify({ ...baseline, featured: CURRENT_FOUR.slice(1) }),
    `{"schemaVersion":1,"schemaVersion":1,"order":[],"hidden":[],"featured":${JSON.stringify(CURRENT_FOUR)}}`,
    `{"schemaVersion":1,"order":[],"\\u006frder":[],"hidden":[],"featured":${JSON.stringify(CURRENT_FOUR)}}`,
    " ".repeat(64 * 1024 + 1),
    `{"bad":"${"가".repeat(23_000)}"}`,
  ];
  for (const text of invalid) {
    await importText(page, text);
    await expect(manager(page).getByRole("alert")).toBeVisible();
    expect((await exported(page)).value).toEqual(draft);
  }
  const partial = { ...baseline, order: [baseline.order.at(-1)!], featured: [...CURRENT_FOUR].reverse() };
  const cancel = dialog(page, false, /변경|초안/);
  await importText(page, JSON.stringify(partial));
  await cancel;
  expect((await exported(page)).value).toEqual(draft);
  const accept = dialog(page, true, /변경|초안/);
  await importText(page, JSON.stringify(partial));
  await accept;
  await expect(manager(page).getByRole("alert")).toHaveCount(0);
  const normalized = (await exported(page)).value;
  expect(normalized.order).toEqual([...partial.order, ...baseline.order.filter((id) => !partial.order.includes(id))]);
  expect(normalized.featured).toEqual(partial.featured);
});

test("search and visibility filters disable global reorder but permit restore", async ({ page }) => {
  await openManager(page);
  const ids = await catalogIds(page);
  await manager(page).getByRole("searchbox", { name: "프로젝트 검색" }).fill(ids[1]);
  await expect(row(page, ids[1]).getByRole("button", { name: `${ids[1]} 목록 위로`, exact: true })).toBeDisabled();
  await expect(manager(page).getByText(/검색·필터 중에는 전체 순서를/)).toBeVisible();
  await expect(row(page, ids[1]).locator("button[draggable]")).toBeDisabled();
  const cancel = dialog(page, false);
  await row(page, ids[1]).getByRole("button", { name: "게시 제외", exact: true }).click();
  await cancel;
  const confirm = dialog(page, true);
  await row(page, ids[1]).getByRole("button", { name: "게시 제외", exact: true }).click();
  await confirm;
  await manager(page).getByLabel("게시 상태 필터", { exact: true }).selectOption("hidden");
  await row(page, ids[1]).getByRole("button", { name: "복원", exact: true }).click();
  await expect(manager(page).getByText("검색 결과가 없습니다.", { exact: true })).toBeVisible();
  await manager(page).getByRole("button", { name: "검색·필터 초기화", exact: true }).click();
  expect(await catalogIds(page)).toEqual(ids);
});

test("keyboard reorder, drag, tab retention, reset confirmation and dirty warning", async ({ page }) => {
  await openManager(page);
  const baseline = await catalogIds(page);
  const down = row(page, baseline[0]).getByRole("button", { name: `${baseline[0]} 목록 아래로`, exact: true });
  await down.focus();
  await page.keyboard.press("Enter");
  await expect(down).toBeFocused();
  let draftOrder = [baseline[1], baseline[0], ...baseline.slice(2)];
  expect(await catalogIds(page)).toEqual(draftOrder);
  if (!test.info().project.use.isMobile) {
    const dragEvents = await page.evaluateHandle(() => {
      const events: { type: string; trusted: boolean; id: string | null; data: string }[] = [];
      for (const type of ["dragstart", "drop"]) document.addEventListener(type, (event) => {
        const drag = event as DragEvent;
        events.push({ type, trusted: drag.isTrusted, id: (drag.target as Element).closest("[data-project-id]")!.getAttribute("data-project-id"), data: drag.dataTransfer!.getData("application/x-jid-portfolio-id") });
      }, { once: true });
      return events;
    });
    // Keep both endpoints visible before mouse-down: dragTo otherwise scrolls
    // the target after pressing the source and Chromium never starts a drag.
    const dropTarget = row(page, baseline[1]);
    await dropTarget.evaluate((node) => node.scrollIntoView({ block: "start" }));
    await row(page, baseline[2]).getByRole("button", { name: `${baseline[2]} 드래그로 목록 이동` }).dragTo(dropTarget, { targetPosition: { x: 20, y: 20 } });
    expect(await dragEvents.jsonValue()).toEqual([
      { type: "dragstart", trusted: true, id: baseline[2], data: baseline[2] },
      { type: "drop", trusted: true, id: baseline[1], data: baseline[2] },
    ]);
    await dragEvents.dispose();
    draftOrder = [baseline[2], baseline[1], baseline[0], ...baseline.slice(3)];
    expect(await catalogIds(page)).toEqual(draftOrder);
  }
  const nav = page.getByRole("navigation", { name: "관리 도구 메뉴" });
  await nav.getByRole("button", { name: "편집기", exact: false }).click();
  await expect(page.getByRole("heading", { name: "프로젝트 기본 정보", exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "프로젝트 목록" }).click();
  expect(await catalogIds(page)).toEqual(draftOrder);
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  const cancel = dialog(page, false, /현재 게시|게시된/);
  await manager(page).getByRole("button", { name: "게시된 설정으로 되돌리기", exact: true }).click();
  await cancel;
  expect(await catalogIds(page)).toEqual(draftOrder);
  const accept = dialog(page, true, /현재 게시|게시된/);
  await manager(page).getByRole("button", { name: "게시된 설정으로 되돌리기", exact: true }).click();
  await accept;
  expect(await catalogIds(page)).toEqual(baseline);
  expect(await featuredIds(page)).toEqual(CURRENT_FOUR);
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
});

test("320px controls, input text and root GitHub instructions are usable without external writes", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openManager(page);
  await expect(manager(page).getByRole("link", { name: "GitHub 루트에 설정 업로드", exact: false })).toHaveAttribute("href", "https://github.com/jidesign-official/jid/upload/main");
  await expect(manager(page).getByRole("link", { name: "Actions 검증·배포 확인", exact: false })).toHaveAttribute("href", "https://github.com/jidesign-official/jid/actions");
  await expect(manager(page).getByText(/다운로드.*게시가 아닙니다/)).toBeVisible();
  await expect(manager(page).getByText(/원본.*비공개/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const sizes = await manager(page).locator("button, a, input:not([type=file]), select").evaluateAll((nodes) => nodes.filter((node) => {
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }).map((node) => {
    const box = node.getBoundingClientRect();
    return { text: node.getAttribute("aria-label") || node.textContent, width: box.width, height: box.height, font: parseFloat(getComputedStyle(node).fontSize), input: node.matches("input, select") };
  }));
  for (const size of sizes) {
    expect(size.width, size.text || "control").toBeGreaterThanOrEqual(44);
    expect(size.height, size.text || "control").toBeGreaterThanOrEqual(44);
    if (size.input) expect(size.font).toBeGreaterThanOrEqual(16);
  }
  const id = (await catalogIds(page))[1];
  await row(page, id).getByRole("button", { name: `${id} 목록 위로`, exact: true }).click();
  expect((await catalogIds(page))[0]).toBe(id);
});

// An actual legacy images-only project remains eligible: it must not depend on GLBs.
test("images-only legacy project can replace a featured choice without touching metadata", async ({ page }) => {
  await openManager(page);
  const legacyImageOnlyId = "jd002";
  const project = row(page, legacyImageOnlyId);
  await expect(project).toBeVisible();
  await expect(project.locator("img")).toHaveAttribute("src", /.+/);
  const title = await project.getByRole("heading", { level: 3 }).innerText();
  await row(page, CURRENT_FOUR[0]).getByRole("checkbox").uncheck();
  await project.getByRole("checkbox").check();
  const value = (await exported(page)).value;
  expect(value.featured).toEqual([...CURRENT_FOUR.slice(1), legacyImageOnlyId]);
  await expect(project.getByRole("heading", { level: 3 })).toHaveText(title);
});

test("bounded asynchronous imports lock edits and reject a second queued file", async ({ page }) => {
  await openManager(page);
  const baseline = (await exported(page)).value;
  const imported = { ...baseline, order: [...baseline.order].reverse() };
  await page.evaluate(() => {
    const original = File.prototype.text;
    const state = window as typeof window & { releasePortfolioRead?: () => void; portfolioReads?: number };
    state.portfolioReads = 0;
    File.prototype.text = function () {
      state.portfolioReads!++;
      const read = original.call(this);
      return new Promise<string>((resolve, reject) => {
        state.releasePortfolioRead = () => { void read.then(resolve, reject); };
      });
    };
  });
  await importText(page, JSON.stringify(imported));
  await expect(manager(page)).toHaveAttribute("aria-busy", "true");
  await expect(row(page, baseline.order[0]).getByRole("button", { name: `${baseline.order[0]} 목록 아래로`, exact: true })).toBeDisabled();
  await expect(manager(page).getByRole("button", { name: "설정 JSON 내보내기" })).toBeDisabled();
  await expect(manager(page).getByRole("searchbox")).toBeDisabled();
  // Synthetic re-entry must be rejected as well as the disabled native control.
  await manager(page).getByLabel("설정 JSON 가져오기", { exact: true }).evaluate((node) => {
    const input = node as HTMLInputElement;
    const files = new DataTransfer();
    files.items.add(new File(["invalid"], "second.json", { type: "application/json" }));
    input.files = files.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(await page.evaluate(() => (window as typeof window & { portfolioReads: number }).portfolioReads)).toBe(1);
  await page.evaluate(() => (window as typeof window & { releasePortfolioRead: () => void }).releasePortfolioRead());
  await expect(manager(page)).toHaveAttribute("aria-busy", "false");
  expect((await exported(page)).value).toEqual(imported);
  await importText(page, " ".repeat(64 * 1024 + 1));
  await expect(manager(page).getByRole("alert")).toContainText("64KiB");
  expect(await page.evaluate(() => (window as typeof window & { portfolioReads: number }).portfolioReads)).toBe(1);
  expect((await exported(page)).value).toEqual(imported);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`portfolio controls retain flat Apple surfaces and readable contrast in ${colorScheme} preference`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await openManager(page);
    await expect(manager(page)).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(manager(page)).toHaveCSS("color", "rgb(29, 29, 31)");
    const card = manager(page).locator("[data-featured-project-id]").first();
    await expect(card).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(card).toHaveCSS("border-radius", "28px");
    await expect(card).toHaveCSS("box-shadow", "none");
    const exportButton = manager(page).getByRole("button", { name: "설정 JSON 내보내기" });
    await expect(exportButton).toHaveCSS("background-color", "rgb(0, 102, 204)");
    const ratios = await manager(page).evaluate((root) => {
      function luminance(color: string) {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((channel) => {
          const value = channel / 255;
          return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
        });
        return channels.reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
      }
      const candidates = [root.querySelector("small")!, root.querySelector("button[aria-describedby='portfolio-export-validation']")!];
      return candidates.map((node) => {
        let ancestor: Element | null = node;
        let background = "rgba(0, 0, 0, 0)";
        while (ancestor && background === "rgba(0, 0, 0, 0)") {
          background = getComputedStyle(ancestor).backgroundColor;
          ancestor = ancestor.parentElement;
        }
        const foreground = luminance(getComputedStyle(node).color);
        const back = luminance(background);
        return (Math.max(foreground, back) + .05) / (Math.min(foreground, back) + .05);
      });
    });
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
    const selected = row(page, CURRENT_FOUR[0]).getByRole("checkbox");
    await selected.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(selected).toBeFocused();
    await expect(selected).toHaveCSS("outline-color", "rgb(0, 102, 204)");
    await expect(selected).toHaveCSS("outline-style", "solid");
  });
}
