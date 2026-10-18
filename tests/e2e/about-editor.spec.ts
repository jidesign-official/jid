import { test, expect, type Page, type Download } from "@playwright/test";
import { ADMIN_PAGE_PATH } from "../helpers/admin-route";

// Independent literal fixture, never the implementation's default builder/parser.
const FIXTURE = {
  schemaVersion: 1,
  headings: { eyebrow: "About QA", philosophy: "Our thinking", history: "Milestones", services: "Capabilities" },
  introduction: { title: "  A new introduction  ", subtitle: "새로운 소개", paragraph: "첫 줄\n둘째 줄\t그대로 보존" },
  philosophy: [
    { id: "qa-first", title: "First idea", subtitle: "첫 생각", paragraph: "첫 번째 설명" },
    { id: "qa-second", title: "Second idea", subtitle: "둘째 생각", paragraph: "두 번째 설명" },
  ],
  history: [{ year: "2030", events: ["First event", "Second event"] }, { year: "2029", events: ["Earlier event"] }],
  services: [{ name: "Research", description: "조사" }, { name: "Design", description: "설계" }],
  links: { portfolioLabel: "Our work", contactLabel: "Talk with us" },
};
type Content = typeof FIXTURE;
test.setTimeout(45_000);
const editor = (page: Page) => page.locator("[data-about-editor]");
async function openEditor(page: Page) {
  await page.goto(ADMIN_PAGE_PATH);
  // A real existing hydrated tab interaction avoids the SSR-input race.
  const menu = page.getByRole("navigation", { name: "관리 도구 메뉴" });
  await menu.getByRole("button", { name: "프로젝트 목록" }).click();
  await expect(page.getByRole("heading", { name: "프로젝트 목록.", exact: true })).toBeVisible();
  await menu.getByRole("button", { name: "About Us 편집", exact: true }).click({ timeout: 4000 });
  await expect(editor(page).getByRole("heading", { name: "About Us 편집.", exact: true })).toBeVisible();
}
async function readDownload(download: Download) {
  expect(download.suggestedFilename()).toBe("about-content.json");
  const stream = await download.createReadStream();
  if (!stream) throw new Error("No browser download stream");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  expect(bytes.byteLength).toBeLessThanOrEqual(64 * 1024);
  const text = bytes.toString("utf8");
  const value = JSON.parse(text) as Content;
  expect(text).toBe(`${JSON.stringify(value, null, 2)}\n`);
  expect(Object.keys(value)).toEqual(["schemaVersion", "headings", "introduction", "philosophy", "history", "services", "links"]);
  return { text, value, download };
}
// Chromium LocalFrame::ShouldThrottleDownload silently drops >10 requests/second.
// Pace only this test driver; keep every real download/content assertion intact.
const lastDownloadAt = new WeakMap<Page, number>();
async function exported(page: Page) {
  const remaining = 125 - (performance.now() - (lastDownloadAt.get(page) ?? -Infinity));
  if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
  const download = page.waitForEvent("download");
  await editor(page).getByRole("button", { name: "About JSON 내보내기", exact: true }).click();
  const actual = await download;
  lastDownloadAt.set(page, performance.now());
  return readDownload(actual);
}
async function importText(page: Page, text: string) {
  await editor(page).getByLabel("About JSON 가져오기", { exact: true }).setInputFiles({ name: "about-content.json", mimeType: "application/json", buffer: Buffer.from(text) });
}
function confirmNext(page: Page, accept: boolean) {
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    if (accept) await dialog.accept(); else await dialog.dismiss();
  });
}

test("published copy becomes an editable canonical browser download, never a publication", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
  await openEditor(page);
  const initial = (await exported(page)).value;
  expect(initial.introduction).toEqual({
    title: "From Imagination to Intuition",
    subtitle: "상상에서 직관으로 이어지는 디자인",
    paragraph: "JiD는 아이디어를 제품으로, 제품을 브랜드의 가치로 연결하는 제품디자인 스튜디오입니다. 우리는 사용자의 경험과 시장의 요구를 탐구하며, 상상 속 가능성을 직관적인 제품 경험으로 구현합니다.",
  });
  expect(initial.headings).toEqual({ eyebrow: "About Us", philosophy: "Design Philosophy", history: "Company History", services: "Our Services" });
  expect(initial.links).toEqual({ portfolioLabel: "View Portfolio", contactLabel: "Start a Project" });
  expect(initial.philosophy.map((item) => item.id)).toEqual(["imagination-and-intuition", "questions-and-answers", "beyond-form"]);
  expect(initial.history.map((item) => item.year)).toEqual(["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025"]);
  expect(initial.services.map((item) => item.name)).toEqual(["Product Design", "Industrial Design", "3D Modeling & Rendering", "Prototype Development", "Design Consulting"]);
  await editor(page).getByLabel("소개 제목", { exact: true }).fill("Edited locally");
  await editor(page).getByLabel("상단 작은 제목", { exact: true }).fill("About our team");
  await editor(page).getByLabel("포트폴리오 링크 문구", { exact: true }).fill("Explore our work");
  await editor(page).getByLabel("문의 링크 문구", { exact: true }).fill("Contact the team");
  const changed = (await exported(page)).value;
  expect(changed).toEqual({ ...initial, headings: { ...initial.headings, eyebrow: "About our team" }, introduction: { ...initial.introduction, title: "Edited locally" }, links: { portfolioLabel: "Explore our work", contactLabel: "Contact the team" } });
  await expect(editor(page).getByText("게시되지 않은 About 변경", { exact: true })).toBeVisible();
  await expect(editor(page).getByRole("link", { name: "현재 게시된 About 보기" })).toHaveAttribute("href", /\/about\/$/);
  await expect(editor(page).getByRole("link", { name: "GitHub 루트에 About JSON 업로드" })).toHaveAttribute("href", "https://github.com/jidesign-official/jid/upload/main");
  await expect(editor(page).getByRole("link", { name: "Actions 검증·배포 확인" })).toHaveAttribute("href", "https://github.com/jidesign-official/jid/actions");
  expect(writes).toEqual([]);
  await expect(page.locator("footer")).toHaveCount(0);
});

test("structured lists preserve identity, keyboard order and confirmed deletion", async ({ page }, testInfo) => {
  await openEditor(page);
  await importText(page, JSON.stringify(FIXTURE));
  await expect(editor(page).getByLabel("소개 제목", { exact: true })).toHaveValue(FIXTURE.introduction.title);
  expect((await exported(page)).value).toEqual(FIXTURE);
  await editor(page).getByLabel("철학 1 제목", { exact: true }).fill("Changed title");
  const down = editor(page).getByRole("button", { name: "철학 1 아래로", exact: true });
  await down.focus();
  await page.keyboard.press("Enter");
  await expect(editor(page).getByLabel("철학 2 제목", { exact: true })).toHaveValue("Changed title");
  await editor(page).getByRole("button", { name: "연혁 1 아래로", exact: true }).click();
  await editor(page).getByRole("button", { name: "연혁 2 사건 1 아래로", exact: true }).click();
  await editor(page).getByRole("button", { name: "서비스 1 아래로", exact: true }).click();
  const orderedDownload = await exported(page);
  const ordered = orderedDownload.value;
  expect(ordered.philosophy.map((item) => item.id)).toEqual(["qa-second", "qa-first"]);
  expect(ordered.history).toEqual([FIXTURE.history[1], { year: "2030", events: ["Second event", "First event"] }]);
  expect(ordered.services).toEqual([...FIXTURE.services].reverse());
  // Durable real browser bytes for the parent's exact export → gate → build proof.
  const artifactPath = testInfo.outputPath("about-content.json");
  await orderedDownload.download.saveAs(artifactPath);
  await testInfo.attach("actual-about-browser-export", { path: artifactPath, contentType: "application/json" });
  confirmNext(page, false);
  await editor(page).getByRole("button", { name: "철학 1 삭제", exact: true }).click();
  expect((await exported(page)).value).toEqual(ordered);
  confirmNext(page, true);
  await editor(page).getByRole("button", { name: "철학 1 삭제", exact: true }).click();
  await editor(page).getByRole("button", { name: "철학 추가", exact: true }).click();
  await expect(editor(page).getByRole("button", { name: "About JSON 내보내기" })).toBeDisabled();
  await expect(editor(page).getByText(/내보낼 수 없습니다/)).toBeVisible();
  await editor(page).getByLabel("철학 2 제목", { exact: true }).fill("New philosophy");
  await editor(page).getByLabel("철학 2 부제", { exact: true }).fill("새로운 생각");
  await editor(page).getByLabel("철학 2 본문", { exact: true }).fill("새로운 설명");
  const newId = (await exported(page)).value.philosophy[1].id;
  expect(newId).toMatch(/^[a-z][a-z0-9-]{0,63}$/);
  expect(["qa-first", "qa-second", "about-introduction", "about-philosophy", "about-history", "about-services"]).not.toContain(newId);
  await editor(page).getByLabel("철학 2 제목", { exact: true }).fill("Renamed again");
  expect((await exported(page)).value.philosophy[1].id).toBe(newId);
  await editor(page).getByRole("button", { name: "연혁 추가", exact: true }).click();
  await editor(page).getByLabel("연혁 3 연도", { exact: true }).pressSequentially("2031");
  await expect(editor(page).getByLabel("연혁 3 연도", { exact: true })).toBeFocused();
  await editor(page).getByLabel("연혁 3 사건 1", { exact: true }).fill("New milestone");
  await editor(page).getByRole("button", { name: "연혁 3 사건 추가", exact: true }).click();
  await editor(page).getByLabel("연혁 3 사건 2", { exact: true }).fill("Another milestone");
  confirmNext(page, false);
  await editor(page).getByRole("button", { name: "연혁 3 사건 1 삭제", exact: true }).click();
  await expect(editor(page).getByLabel("연혁 3 사건 1", { exact: true })).toHaveValue("New milestone");
  confirmNext(page, true);
  await editor(page).getByRole("button", { name: "연혁 3 사건 1 삭제", exact: true }).click();
  await expect(editor(page).getByLabel("연혁 3 사건 1", { exact: true })).toHaveValue("Another milestone");
  await editor(page).getByRole("button", { name: "서비스 추가", exact: true }).click();
  await editor(page).getByLabel("서비스 3 이름", { exact: true }).pressSequentially("New service");
  await expect(editor(page).getByLabel("서비스 3 이름", { exact: true })).toBeFocused();
  await editor(page).getByLabel("서비스 3 설명", { exact: true }).fill("새 서비스 설명");
  expect((await exported(page)).value.services[2]).toEqual({ name: "New service", description: "새 서비스 설명" });
  for (const kind of ["철학", "연혁", "서비스"]) {
    while (await editor(page).getByRole("button", { name: `${kind} 1 삭제`, exact: true }).count()) {
      confirmNext(page, true);
      await editor(page).getByRole("button", { name: `${kind} 1 삭제`, exact: true }).click();
    }
  }
  const empty = (await exported(page)).value;
  expect([empty.philosophy, empty.history, empty.services]).toEqual([[], [], []]);
  await expect(editor(page).getByText(/항목이 없으면 게시 화면에서 이 섹션/)).toHaveCount(3);
});

test("invalid imports preserve draft and errors; replacement and published reset require confirmation", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
  await openEditor(page);
  const published = (await exported(page)).value;
  await importText(page, JSON.stringify(FIXTURE));
  await expect(editor(page).getByLabel("소개 제목", { exact: true })).toHaveValue(FIXTURE.introduction.title);
  const invalid = [
    "{", JSON.stringify({ ...FIXTURE, unknown: true }),
    JSON.stringify({ ...FIXTURE, schemaVersion: "1" }),
    JSON.stringify({ ...FIXTURE, introduction: { ...FIXTURE.introduction, paragraph: "   " } }),
    JSON.stringify({ ...FIXTURE, philosophy: [FIXTURE.philosophy[0], FIXTURE.philosophy[0]] }),
    JSON.stringify({ ...FIXTURE, philosophy: [{ ...FIXTURE.philosophy[0], id: "about-history" }] }),
    JSON.stringify({ ...FIXTURE, history: [{ year: "0202", events: ["Event"] }] }),
    JSON.stringify({ ...FIXTURE, history: [{ year: "2030", events: [] }] }),
    JSON.stringify({ ...FIXTURE, services: [FIXTURE.services[0], FIXTURE.services[0]] }),
    JSON.stringify({ ...FIXTURE, links: { ...FIXTURE.links, contactLabel: "x".repeat(121) } }),
    `{"schemaVersion":1,"\\u0073chemaVersion":1,${JSON.stringify(FIXTURE).slice(1)}`,
    " ".repeat(64 * 1024 + 1),
    JSON.stringify({ ...FIXTURE, introduction: { ...FIXTURE.introduction, paragraph: "가".repeat(23000) } }),
  ];
  for (const text of invalid) {
    await importText(page, text);
    await expect(editor(page).getByRole("alert")).toContainText("현재 편집 내용은 유지됩니다");
    expect((await exported(page)).value).toEqual(FIXTURE);
    // A successful export must not hide a failed import's error.
    await expect(editor(page).getByRole("alert")).toBeVisible();
  }
  const replacement = { ...FIXTURE, introduction: { ...FIXTURE.introduction, title: "Replacement" } };
  confirmNext(page, false);
  await importText(page, JSON.stringify(replacement));
  expect((await exported(page)).value).toEqual(FIXTURE);
  confirmNext(page, true);
  await importText(page, JSON.stringify(replacement));
  await expect(editor(page).getByLabel("소개 제목", { exact: true })).toHaveValue("Replacement");
  await expect(editor(page).getByRole("alert")).toHaveCount(0);
  // Same file may be selected again, including after cancellation/error.
  confirmNext(page, true);
  await importText(page, JSON.stringify(replacement));
  await expect(editor(page).getByRole("button", { name: "About JSON 내보내기" })).toBeEnabled();
  const menu = page.getByRole("navigation", { name: "관리 도구 메뉴" });
  for (const tab of ["편집기", "프로젝트 목록", "게시 안내", "계정 · 권한"]) {
    await menu.getByRole("button", { name: tab, exact: true }).click();
    await expect(page.locator("[data-admin-shell] header").getByText("● 저장하지 않은 변경", { exact: true })).toBeVisible();
  }
  await menu.getByRole("button", { name: "About Us 편집", exact: true }).click();
  expect((await exported(page)).value).toEqual(replacement);
  expect(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(true);
  confirmNext(page, false);
  await editor(page).getByRole("button", { name: "현재 게시된 내용으로 되돌리기", exact: true }).click();
  expect((await exported(page)).value).toEqual(replacement);
  confirmNext(page, true);
  await editor(page).getByRole("button", { name: "현재 게시된 내용으로 되돌리기", exact: true }).click();
  expect((await exported(page)).value).toEqual(published);
  await expect(editor(page).getByText("현재 게시된 About 내용", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(false);
  // About reset must not clear an unrelated project draft or its dirty boundary.
  await menu.getByRole("button", { name: "편집기", exact: true }).click();
  await page.getByLabel("프로젝트 제목", { exact: true }).fill("Independent ZIP draft");
  await menu.getByRole("button", { name: "About Us 편집", exact: true }).click();
  await importText(page, JSON.stringify(FIXTURE));
  await expect(editor(page).getByLabel("소개 제목", { exact: true })).toHaveValue(FIXTURE.introduction.title);
  confirmNext(page, true);
  await editor(page).getByRole("button", { name: "현재 게시된 내용으로 되돌리기", exact: true }).click();
  await expect(page.locator("[data-admin-shell] header").getByText("● 저장하지 않은 변경", { exact: true })).toBeVisible();
  await menu.getByRole("button", { name: "편집기", exact: true }).click();
  await expect(page.getByLabel("프로젝트 제목", { exact: true })).toHaveValue("Independent ZIP draft");
  expect(writes).toEqual([]);
});

test("bounded async import locks immediately and rejects oversized files before reading", async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    const original = File.prototype.text;
    const state = window as unknown as { aboutReadCount: number; releaseAboutRead?: () => void };
    state.aboutReadCount = 0;
    File.prototype.text = function () {
      state.aboutReadCount++;
      if (this.name === "slow.json") return new Promise<string>((resolve) => {
        state.releaseAboutRead = () => { void original.call(this).then(resolve); };
      });
      return original.call(this);
    };
  });
  await importText(page, " ".repeat(64 * 1024 + 1));
  await expect(editor(page).getByRole("alert")).toContainText("64KiB");
  expect(await page.evaluate(() => (window as unknown as { aboutReadCount: number }).aboutReadCount)).toBe(0);
  await editor(page).getByLabel("About JSON 가져오기", { exact: true }).setInputFiles({ name: "slow.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(FIXTURE)) });
  await expect.poll(() => page.evaluate(() => (window as unknown as { aboutReadCount: number }).aboutReadCount)).toBe(1);
  await expect(editor(page).getByLabel("소개 제목", { exact: true })).toBeDisabled();
  await expect(editor(page).getByLabel("About JSON 가져오기", { exact: true })).toBeDisabled();
  await expect(editor(page).getByRole("button", { name: "About JSON 내보내기" })).toBeDisabled();
  await expect(editor(page).getByRole("button", { name: "현재 게시된 내용으로 되돌리기" })).toBeDisabled();
  // Dispatch a competing event in the same busy window: the ref, not just disabled rendering, is the guard.
  await editor(page).getByLabel("About JSON 가져오기", { exact: true }).evaluate((input, text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], "competing.json", { type: "application/json" }));
    (input as HTMLInputElement).files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, JSON.stringify({ ...FIXTURE, introduction: { ...FIXTURE.introduction, title: "Must not win" } }));
  expect(await page.evaluate(() => (window as unknown as { aboutReadCount: number }).aboutReadCount)).toBe(1);
  await page.evaluate(() => (window as unknown as { releaseAboutRead: () => void }).releaseAboutRead());
  await expect(editor(page).getByLabel("소개 제목", { exact: true })).toHaveValue(FIXTURE.introduction.title);
  expect((await exported(page)).value).toEqual(FIXTURE);
  await expect(editor(page).getByRole("alert")).toHaveCount(0);
});

test("actual root dark theme stays light, safe text and 320px controls do not overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openEditor(page);
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(page.locator("html")).toHaveClass(/dark/);
  const markup = '<img src=x onerror="window.aboutInjected=true">';
  await importText(page, JSON.stringify({ ...FIXTURE, introduction: { ...FIXTURE.introduction, paragraph: markup } }));
  await expect(editor(page).getByLabel("소개 본문", { exact: true })).toHaveValue(markup);
  expect((await exported(page)).value.introduction.paragraph).toBe(markup);
  expect(await page.evaluate(() => (window as unknown as { aboutInjected?: boolean }).aboutInjected)).toBeUndefined();
  await expect(editor(page).locator("img, iframe, script")).toHaveCount(0);
  const metrics = await editor(page).evaluate((root) => ({
    background: getComputedStyle(root).backgroundColor,
    color: getComputedStyle(root).color,
    colorScheme: getComputedStyle(root).colorScheme,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    inputs: [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type="file"]),textarea')].map((input) => ({
      font: parseFloat(getComputedStyle(input).fontSize), height: input.getBoundingClientRect().height,
      color: getComputedStyle(input).color, background: getComputedStyle(input).backgroundColor,
      radius: getComputedStyle(input).borderRadius,
    })),
    controls: [...root.querySelectorAll<HTMLElement>('button,a,label:has(input[type="file"])')].map((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })),
  }));
  expect(metrics.background).toBe("rgb(255, 255, 255)");
  expect(metrics.color).toBe("rgb(29, 29, 31)");
  expect(metrics.colorScheme).toBe("light");
  expect(metrics.overflow).toBe(false);
  for (const input of metrics.inputs) {
    expect(input.font).toBeGreaterThanOrEqual(16);
    expect(input.height).toBeGreaterThanOrEqual(44);
    expect(input.background).toBe("rgb(255, 255, 255)");
    expect(input.color).toBe("rgb(29, 29, 31)");
    expect(input.radius).toBe("12px");
  }
  for (const control of metrics.controls) { expect(control.width).toBeGreaterThanOrEqual(44); expect(control.height).toBeGreaterThanOrEqual(44); }
  await expect(page.locator("footer")).toHaveCount(0);
});
