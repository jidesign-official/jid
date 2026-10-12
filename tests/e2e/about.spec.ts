import { test, expect } from "@playwright/test";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const aboutPath = `${basePath}/about/`;

// Independent transcription of ABOUT US.docx, not imported production data.
const documentBlocks = [
  {
    title: "From Imagination to Intuition",
    subtitle: "상상에서 직관으로 이어지는 디자인",
    paragraph: "JiD는 아이디어를 제품으로, 제품을 브랜드의 가치로 연결하는 제품디자인 스튜디오입니다. 우리는 사용자의 경험과 시장의 요구를 탐구하며, 상상 속 가능성을 직관적인 제품 경험으로 구현합니다.",
  },
  {
    title: "Design that bridges imagination and intuition",
    subtitle: "상상력과 직관을 연결하는 디자인",
    paragraph: "좋은 디자인은 단순히 아름다운 형태를 만드는 것이 아닙니다. 감각적인 아이디어와 논리적인 접근이 균형을 이룰 때 비로소 사람들에게 자연스럽게 이해되고 경험됩니다. JiD는 그 연결점을 찾아 브랜드와 사용자를 이어주는 디자인을 만듭니다.",
  },
  {
    title: "Between a question mark and an exclamation mark",
    subtitle: "질문에서 시작해 직관적인 답을 만듭니다",
    paragraph: '우리는 "왜 필요한가?"라는 질문에서 디자인을 시작합니다. 사용자의 니즈와 브랜드의 목표를 깊이 이해하고, 상상력의 물음표와 직관의 느낌표 사이에서 가장 효과적이고 아름다운 해답을 제안합니다.',
  },
  {
    title: "Design Beyond Form",
    subtitle: "형태를 넘어 가치를 디자인합니다",
    paragraph: "제품은 단순한 물건이 아니라 브랜드의 철학과 사용자의 경험을 담는 매개체입니다. JiD는 제품의 형태와 기능, 그리고 브랜드가 전달하고자 하는 가치를 함께 설계하여 의미 있는 경험을 만들어갑니다.",
  },
] as const;

const documentHistory = [
  { year: "2018", events: ["제품디자인 전문 스튜디오 설립", "산업디자인 및 3D 모델링 서비스 시작", "중소기업 및 스타트업 대상 제품 개발 프로젝트 수행"] },
  { year: "2019", events: ["소비재 및 생활가전 분야 프로젝트 확대", "제품 디자인 프로세스 체계화", "시제품 제작 및 개발 지원 서비스 구축"] },
  { year: "2020", events: ["제조 기업과의 협업 프로젝트 다수 진행", "제품 기획부터 양산 지원까지 통합 디자인 서비스 제공", "디자인 경쟁력 강화를 위한 연구개발 역량 확보"] },
  { year: "2021", events: ["산업용 장비 및 전문기기 디자인 분야 진출", "사용자 경험(UX)을 반영한 제품 개발 프로젝트 확대", "다양한 분야의 파트너사와 협력 네트워크 구축"] },
  { year: "2022", events: ["제품 디자인 및 엔지니어링 협업 프로세스 강화", "브랜드 아이덴티티를 고려한 디자인 컨설팅 서비스 확대", "다수의 양산 제품 출시 지원"] },
  { year: "2023", events: ["신규 제품 개발 프로젝트 증가", "3D 시각화 및 디자인 검증 시스템 고도화", "국내외 시장 진출을 위한 제품 개발 지원"] },
  { year: "2024", events: ["다양한 산업 분야의 디자인 프로젝트 수행", "제품 경쟁력 향상을 위한 디자인 전략 서비스 제공", "고객 맞춤형 제품 개발 솔루션 확대"] },
  { year: "2025", events: ["제품디자인 전문 파트너로서 사업 영역 확장", "디자인, 설계, 시제품 제작 연계 서비스 강화", "지속 가능한 제품 개발 및 미래지향적 디자인 연구 추진"] },
] as const;

const documentServices = [
  { name: "Product Design", description: "사용자 경험과 시장성을 고려한 제품 디자인 개발" },
  { name: "Industrial Design", description: "제품의 기능과 형태를 통합한 산업디자인 솔루션 제공" },
  { name: "3D Modeling & Rendering", description: "고품질 3D 모델링 및 시각화 서비스" },
  { name: "Prototype Development", description: "시제품 제작 및 검증 지원" },
  { name: "Design Consulting", description: "제품 개발 및 디자인 전략 컨설팅" },
] as const;

test.beforeEach(async ({ context }, testInfo) => {
  const origin = new URL(testInfo.project.use.baseURL ?? "http://localhost:3000").origin;
  // No dependency on existing remote font CDNs or other external services.
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
});

test("About renders all four exact bilingual document blocks with one h1", async ({ page }) => {
  await page.goto(aboutPath);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(documentBlocks[0].title);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  const about = page.getByRole("article", { name: "About JiD", exact: true });
  await expect(about.getByText("About Us", { exact: true })).toBeVisible();
  await expect(about.getByRole("heading", { level: 2, name: "Design Philosophy", exact: true })).toBeVisible();
  for (const [index, block] of documentBlocks.entries()) {
    const region = about.getByRole("region", { name: block.title, exact: true });
    await expect(region).toBeVisible();
    await expect(region.getByRole("heading", { level: index === 0 ? 1 : 3, name: block.title, exact: true })).toBeVisible();
    await expect(region.getByText(block.subtitle, { exact: true })).toBeVisible();
    await expect(region.getByText(block.paragraph, { exact: true })).toBeVisible();
    await expect(region.getByText(block.subtitle, { exact: true })).toHaveAttribute("lang", "ko");
    await expect(region.getByText(block.paragraph, { exact: true })).toHaveAttribute("lang", "ko");
  }
  await expect(about.locator("h4, h5, h6")).toHaveCount(0);
});

test("Company History preserves eight chronological years and all 24 exact events", async ({ page }) => {
  await page.goto(aboutPath);
  const history = page.getByRole("region", { name: "Company History", exact: true });
  await expect(history.getByRole("heading", { level: 2, name: "Company History", exact: true })).toBeVisible();
  const years = history.locator("ol > li");
  await expect(years).toHaveCount(8);
  await expect(years.locator("time")).toHaveText(documentHistory.map(({ year }) => year));
  await expect(history.locator("ol > li > ul > li")).toHaveCount(24);
  for (const [index, item] of documentHistory.entries()) {
    await expect(years.nth(index).locator("time")).toHaveAttribute("datetime", item.year);
    await expect(years.nth(index).locator("ul > li")).toHaveText([...item.events]);
  }
});

test("Our Services preserves five exact English names and Korean descriptions", async ({ page }) => {
  await page.goto(aboutPath);
  const services = page.getByRole("region", { name: "Our Services", exact: true });
  await expect(services.getByRole("heading", { level: 2, name: "Our Services", exact: true })).toBeVisible();
  await expect(services.locator("dl > div")).toHaveCount(5);
  await expect(services.locator("dt")).toHaveText(documentServices.map(({ name }) => name));
  await expect(services.locator("dd")).toHaveText(documentServices.map(({ description }) => description));
});

test("About metadata uses the document introduction and removes all placeholder copy", async ({ page }) => {
  await page.goto(aboutPath);
  await expect(page).toHaveTitle("About Us - JiD");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", documentBlocks[0].paragraph);
  await expect(page.locator("main")).not.toContainText(/이곳은 About Us 페이지입니다|추후 회사 소개|예비 공간/);
});

test("About links to real portfolio and contact routes with accessible touch targets and focus rings", async ({ page }) => {
  await page.goto(aboutPath);
  const about = page.getByRole("article", { name: "About JiD", exact: true });
  await expect(about.getByRole("navigation", { name: "Explore JiD", exact: true })).toHaveAttribute("lang", "en");
  for (const [label, path] of [["View Portfolio", "/portfolio/"], ["Start a Project", "/contact/"]]) {
    const link = about.getByRole("link", { name: label, exact: true });
    await expect(link).toHaveAttribute("href", `${basePath}${path}`);
    await link.scrollIntoViewIfNeeded();
    const box = await link.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await link.focus();
    await expect(link).toBeFocused();
    const focus = await link.evaluate((element) => {
      const styles = getComputedStyle(element);
      return { width: parseFloat(styles.outlineWidth), style: styles.outlineStyle };
    });
    expect(focus.width).toBeGreaterThanOrEqual(2);
    expect(focus.style).not.toBe("none");
  }
});

for (const width of [320, 390, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`About fits ${width}px in ${theme} mode without clipping or page errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
      await page.goto(aboutPath, { waitUntil: "networkidle" });
      await page.evaluate((value) => document.documentElement.classList.toggle("dark", value === "dark"), theme);
      const about = page.getByRole("article", { name: "About JiD", exact: true });
      await expect(about).toBeVisible();
      expect(await about.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(theme === "dark" ? "rgb(17, 17, 17)" : "rgb(245, 245, 247)");
      expect(await about.evaluate((element) => getComputedStyle(element).color)).toBe(theme === "dark" ? "rgb(245, 245, 247)" : "rgb(29, 29, 31)");
      for (const block of documentBlocks) {
        const heading = about.getByRole("heading", { name: block.title, exact: true });
        await heading.scrollIntoViewIfNeeded();
        await expect(heading).toBeVisible();
        const bounds = await heading.boundingBox();
        expect(bounds?.x).toBeGreaterThanOrEqual(0);
        expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width);
        expect(await heading.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      for (const label of ["View Portfolio", "Start a Project"]) {
        const link = about.getByRole("link", { name: label, exact: true });
        await link.scrollIntoViewIfNeeded();
        const bounds = await link.boundingBox();
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
        expect(bounds?.x).toBeGreaterThanOrEqual(0);
        expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width);
      }
      const overflow = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      expect(overflow.document).toBeLessThanOrEqual(overflow.viewport);
      expect(overflow.body).toBeLessThanOrEqual(overflow.viewport);
      expect(errors).toEqual([]);
    });
  }
}

test("all document business copy is readable without client JavaScript", async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: testInfo.project.use.baseURL,
  });
  const origin = new URL(testInfo.project.use.baseURL ?? "http://localhost:3000").origin;
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  try {
    const page = await context.newPage();
    await page.goto(aboutPath);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(documentBlocks[0].title);
    for (const block of documentBlocks) {
      await expect(page.locator("main").getByText(block.paragraph, { exact: true })).toBeVisible();
    }
    for (const item of documentHistory) {
      for (const event of item.events) {
        await expect(page.locator("main").getByText(event, { exact: true })).toBeVisible();
      }
    }
    for (const service of documentServices) {
      await expect(page.locator("main").getByText(service.description, { exact: true })).toBeVisible();
    }
  } finally {
    await context.close();
  }
});
