import { test, expect, type Page } from "@playwright/test";

const endpoint = "https://formsubmit.co/mail@jid.kr";
const contactPath = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/contact/`;

// SSR visibility/network silence alone do not prove React is interactive.
// Verify a real state transition, then restore the initial form selections.
async function openInteractiveContact(page: Page) {
  await page.goto(contactPath, { waitUntil: "networkidle" });
  const product = page.getByRole("button", { name: "Product", exact: true });
  await product.click();
  await expect(product).toHaveAttribute("aria-pressed", "true");
  await product.click();
  await expect(product).toHaveAttribute("aria-pressed", "false");
}

// Never contact the provider: even unexpected external requests are blocked.
test.beforeEach(async ({ context }, testInfo) => {
  const siteOrigin = new URL(testInfo.project.use.baseURL ?? "http://localhost:3000").origin;
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === siteOrigin) {
      await route.continue();
    } else {
      await route.abort();
    }
  });
});

test("contact submits all fields by native POST with CAPTCHA enabled", async ({ page }) => {
  // Wait for client hydration before filling controlled inputs (not just SSR HTML).
  await openInteractiveContact(page);
  const form = page.locator("form");
  await expect(form).toHaveAttribute("action", endpoint);
  await expect(form).toHaveAttribute("method", /post/i);

  await page.getByLabel("성함 / 담당자명", { exact: false }).fill("테스트 담당자");
  await page.getByLabel("이메일 주소", { exact: false }).fill("test@example.com");
  await page.getByLabel("회사명 / 브랜드명").fill("Test Studio");
  await page.getByLabel("프로젝트 설명 및 상세 요청사항", { exact: false }).fill("제품 & UX 디자인 문의\n희망 일정: 협의");
  await page.getByRole("button", { name: "Product", exact: true }).click();
  await page.getByRole("button", { name: "UX/UI", exact: true }).click();
  await page.getByRole("button", { name: "1,000만원 - 3,000만원", exact: true }).click();
  await expect(page.getByRole("button", { name: "Product", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("checkbox", { name: /FormSubmit/ }).check();

  const expectedFields = {
    _subject: "[JiD 문의] 프로젝트 문의",
    _template: "table",
    _captcha: "true",
    _honey: "",
    _next: "https://jidesign-official.github.io/jid/contact/thanks/",
    name: "테스트 담당자",
    email: "test@example.com", // FormSubmit uses the email field as Reply-To.
    company: "Test Studio",
    message: "제품 & UX 디자인 문의\n희망 일정: 협의",
    selectedTypes: "Product, UX/UI",
    selectedBudget: "1,000만원 - 3,000만원",
    consent: "acknowledged",
  };
  expect(await form.evaluate((element) => Object.fromEntries(new FormData(element as HTMLFormElement)))).toEqual(expectedFields);

  // A local 204 keeps the page open; no request reaches FormSubmit.
  await page.route(endpoint, (route) => route.fulfill({ status: 204 }));
  const requestPromise = page.waitForRequest(endpoint);
  await page.getByRole("button", { name: "이메일로 문의 보내기" }).click();
  const request = await requestPromise;
  expect(request.url()).toBe(endpoint);
  expect(request.method()).toBe("POST");
  expect(request.isNavigationRequest()).toBe(true);
  expect(request.resourceType()).toBe("document");
  expect(request.headers()["content-type"]).toContain("application/x-www-form-urlencoded");
  const fields = Object.fromEntries(new URLSearchParams(request.postData() ?? ""));
  fields.message = fields.message.replace(/\r\n/g, "\n");
  expect(fields).toEqual(expectedFields);
  await expect(page.getByRole("button", { name: "이메일로 문의 보내기" })).toBeEnabled();
  await expect(page.getByText("이메일 프로그램이 연결되었습니다!")).toHaveCount(0);
  await expect(form).toBeVisible();
});

test("batched field changes preserve both name and email", async ({ page }) => {
  await openInteractiveContact(page);
  const product = page.getByRole("button", { name: "Product", exact: true });
  await product.click();
  await expect(product).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    for (const [id, value] of [["contact-name", "Batched Name"], ["contact-email", "batch@example.com"]]) {
      const input = document.getElementById(id)!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await expect(page.getByLabel("성함 / 담당자명", { exact: false })).toHaveValue("Batched Name");
  await expect(page.getByLabel("이메일 주소", { exact: false })).toHaveValue("batch@example.com");
});

test("native validation blocks missing required fields, invalid email and missing consent", async ({ page }) => {
  let externalRequests = 0;
  await page.route(endpoint, async (route) => {
    externalRequests += 1;
    await route.abort();
  });
  // Wait for client hydration before filling controlled inputs (not just SSR HTML).
  await openInteractiveContact(page);
  const submit = page.getByRole("button", { name: "이메일로 문의 보내기" });
  const name = page.getByLabel("성함 / 담당자명", { exact: false });
  const email = page.getByLabel("이메일 주소", { exact: false });
  const message = page.getByLabel("프로젝트 설명 및 상세 요청사항", { exact: false });
  const consent = page.getByRole("checkbox", { name: /FormSubmit/ });
  await submit.click();
  expect(await name.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  await name.fill("테스트");
  await email.fill("not-an-email");
  await submit.click();
  expect(await email.evaluate((input: HTMLInputElement) => input.validity.typeMismatch)).toBe(true);
  await email.fill("test@example.com");
  await submit.click();
  expect(await message.evaluate((input: HTMLTextAreaElement) => input.validity.valueMissing)).toBe(true);
  await message.fill("테스트 문의");
  await submit.click();
  expect(await consent.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  await expect(consent).not.toBeChecked();
  await expect(page).toHaveURL(new RegExp(`${contactPath}$`));
  await expect(submit).toBeEnabled();
  expect(externalRequests).toBe(0);
  await expect(page.locator("#contact-privacy")).toContainText("reCAPTCHA");
  await expect(page.locator("#contact-privacy")).toContainText("30일");
});

test("service toggles and budget changes serialize only current choices", async ({ page }) => {
  // Wait for client hydration before filling controlled inputs (not just SSR HTML).
  await openInteractiveContact(page);
  await expect(page.getByRole("group", { name: /관심 서비스 분야/ })).toBeVisible();
  await expect(page.getByRole("group", { name: /예상 예산 범위/ })).toBeVisible();
  await expect(page.locator('[name="_honey"]')).toBeHidden();
  await expect(page.locator('[name="selectedTypes"]')).toHaveValue("");
  await expect(page.locator('[name="selectedBudget"]')).toHaveValue("");
  await page.getByRole("button", { name: "Product", exact: true }).click();
  await page.getByRole("button", { name: "UX/UI", exact: true }).click();
  await page.getByRole("button", { name: "Product", exact: true }).click();
  await page.getByRole("button", { name: "1,000만원 미만", exact: true }).click();
  await page.getByRole("button", { name: "5,000만원 이상", exact: true }).click();
  await expect(page.locator('[name="selectedTypes"]')).toHaveValue("UX/UI");
  await expect(page.locator('[name="selectedBudget"]')).toHaveValue("5,000만원 이상");
  await expect(page.getByRole("button", { name: "Product", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "1,000만원 미만", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("manual email fallback contains the draft without claiming a sent message", async ({ page }) => {
  // Wait for client hydration before filling controlled inputs (not just SSR HTML).
  await openInteractiveContact(page);
  await page.getByLabel("성함 / 담당자명", { exact: false }).fill("테스트");
  await page.getByLabel("프로젝트 설명 및 상세 요청사항", { exact: false }).fill("직접 보낼 내용");
  const mailto = await page.getByRole("link", { name: "메일 앱으로 직접 보내기" }).getAttribute("href");
  expect(mailto).toMatch(/^mailto:mail@jid.kr\?/);
  const parameters = new URLSearchParams(mailto!.split("?")[1]);
  expect(parameters.get("subject")).toContain("테스트");
  expect(parameters.get("body")).toContain("직접 보낼 내용");
  await expect(page.getByText(/메일 앱에서는 직접 \[보내기\]를 눌러야 합니다/)).toBeVisible();
  await expect(page.getByText("이메일 프로그램이 연결되었습니다!")).toHaveCount(0);
});

for (const fails of [false, true]) {
  test(`manual draft copying reports ${fails ? "failure" : "success"}`, async ({ page }) => {
    await page.addInitScript((shouldFail) => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: async (text: string) => {
          if (shouldFail) throw new Error("Clipboard blocked for this test");
          document.documentElement.dataset.copiedText = text;
        } },
      });
    }, fails);
    // Wait for client hydration before filling controlled inputs (not just SSR HTML).
    await openInteractiveContact(page);
    await page.getByLabel("프로젝트 설명 및 상세 요청사항", { exact: false }).fill("복사할 내용");
    await page.getByRole("button", { name: "문의 내용 복사하기" }).click();
    await expect(page.getByRole("status")).toContainText(fails ? "복사하지 못했습니다" : "문의 내용이 클립보드에 복사되었습니다!");
    if (!fails) {
      expect(await page.evaluate(() => document.documentElement.dataset.copiedText)).toContain("복사할 내용");
    }
    await expect(page.locator("form")).toBeVisible();
  });
}

test("thank-you route explains the provider handoff without asserting inbox delivery", async ({ page }) => {
  const response = await page.goto(`${contactPath}thanks/`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "문의 전송 후 안내" })).toBeVisible();
  await expect(page.getByText(/이 페이지는 메일함 도착을 확인하는 수신 확인증이 아닙니다/)).toBeVisible();
  await expect(page.getByRole("link", { name: "새 문의 작성하기" })).toHaveAttribute("href", contactPath);
  await expect(page.getByRole("link", { name: "mail@jid.kr", exact: true })).toHaveAttribute("href", "mailto:mail@jid.kr");
});
