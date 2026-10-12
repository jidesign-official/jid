import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMailtoLink, formatContactContent } from "../../src/app/actions/contact";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const oldDisplayBrand = /jdesign studio|jiD design(?: studio)?|jdesign의|\[jdesign 문의\]/;
const defaultDescription = "Innovative UI/UX, Branding & Web Design Portfolio";
const routes = [
  { name: "home", path: "/", title: "JiD - Portfolio", description: defaultDescription },
  { name: "about", path: "/about/", title: "About Us - JiD", description: "JiD는 아이디어를 제품으로, 제품을 브랜드의 가치로 연결하는 제품디자인 스튜디오입니다. 우리는 사용자의 경험과 시장의 요구를 탐구하며, 상상 속 가능성을 직관적인 제품 경험으로 구현합니다." },
  { name: "contact", path: "/contact/", title: "JiD - Portfolio", description: defaultDescription },
  { name: "contact thanks", path: "/contact/thanks/", title: "문의 전송 후 안내 | JiD", description: defaultDescription },
  { name: "portfolio", path: "/portfolio/", title: "Portfolio - JiD", description: "JiD의 혁신적인 프로젝트 포트폴리오입니다." },
  { name: "jd001", path: "/portfolio/jd001/", title: "현진기업 휴대용 정수기 - JiD", description: "현진기업 휴대용 정수기 제품 디자인 포트폴리오 상세 페이지입니다." },
];

// Branding checks must not submit a form or contact an external provider.
test.describe("route branding", () => {
  test.beforeEach(async ({ context }, testInfo) => {
    const siteOrigin = new URL(testInfo.project.use.baseURL ?? "http://localhost:3000").origin;
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === siteOrigin ? route.continue() : route.abort(),
    );
  });

  for (const route of routes) {
    test(`${route.name} displays exact JiD branding`, async ({ page }) => {
      const response = await page.goto(`${basePath}${route.path}`);
      expect(response?.status()).toBe(200);
      await expect.soft(page).toHaveTitle(route.title);
      await expect.soft(page.locator('meta[name="description"]')).toHaveAttribute("content", route.description);

      const headerLogos = page.locator("header img");
      await expect.soft(headerLogos).toHaveCount(2);
      for (const logo of await headerLogos.all()) {
        await expect.soft(logo).toHaveAttribute("alt", "JiD");
      }
      await expect.soft(page.locator('header img[alt="JiD"]:visible')).toHaveCount(1);

      // Footer and hero video accessible-name coverage belong to their own tests.
      await expect.soft(page.locator("main")).not.toContainText(oldDisplayBrand);
      if (route.name === "contact") {
        await expect.soft(page.getByText("JiD와 함께 당신의 비전을 완성해보세요.", { exact: false })).toBeVisible();
        await expect.soft(page.getByLabel("회사명 / 브랜드명")).toHaveAttribute("placeholder", "JiD (선택사항)");
        await expect.soft(page.locator('[name="_subject"]')).toHaveValue("[JiD 문의] 프로젝트 문의");
        await page.getByRole("button", { name: "디자인 외에 프론트엔드 웹/앱 개발까지 포함하여 진행 가능한가요?" }).click();
        await expect.soft(page.getByText(/네, 가능합니다\. JiD는 Next\.js/)).toBeVisible();
        await expect.soft(page.locator("main")).not.toContainText(oldDisplayBrand);
      }
      if (route.name === "jd001") {
        await expect.soft(page.getByRole("heading", { level: 1 })).toHaveText("현진기업 휴대용 정수기");
        await expect.soft(page.locator("main h1 + p")).toHaveText(/^(?:Design that bridges imagination and intuition|Between a question mark and an exclamation mark|Design Beyond Form)$/);
        await expect.soft(page.locator("main")).not.toContainText("JiD의 디테일과 심미성이 담긴 산업/의료/제품 디자인 포트폴리오입니다.");
      }
    });
  }
});

test("inquiry drafts use JiD without changing the receiver", () => {
  const draft = { name: "테스트", email: "test@example.com", message: "문의 내용", selectedTypes: [], selectedBudget: "" };
  const link = createMailtoLink(draft);
  expect(link).toMatch(/^mailto:mail@jid\.kr\?/);
  const parameters = new URLSearchParams(link.split("?")[1]);
  expect(parameters.get("subject")).toBe("[JiD 문의] 테스트님의 프로젝트 문의입니다.");
  expect(parameters.get("body")).toBe(formatContactContent(draft));
  expect(formatContactContent(draft)).toContain("📩 [JiD - 프로젝트 문의 내용]");
  expect(formatContactContent(draft)).not.toMatch(oldDisplayBrand);
});

test("brand source text preserves deployment identifiers", () => {
  const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
  const readme = source("README.md");
  expect(readme).toContain("# JiD - Portfolio Web Application");
  expect(readme).not.toMatch(oldDisplayBrand);
  expect(readme).toContain("https://github.com/kkomjirak/jdesign.git");
  expect(readme).toContain("https://kkomjirak.github.io/jdesign/");
  expect(source("src/app/layout.tsx")).toContain('/favicon.ico?v=jid');
  expect(source("src/components/contact/ContactForm.tsx")).toContain("https://kkomjirak.github.io/jdesign/contact/thanks/");
  expect(source("src/app/portfolio/[id]/page.tsx")).toContain('title: "Project Not Found - JiD"');
});
