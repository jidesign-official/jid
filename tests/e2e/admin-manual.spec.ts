import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";

// Opt-in source-component verification while the shared static export is owned by
// integration. Default runs ALWAYS exercise the actual /admin/ route.
if (process.env.ADMIN_MANUAL_SOURCE_HARNESS === "1") {
  const css = readFileSync(
    join(__dirname, "../../src/components/admin/UploadManual.module.css"),
    "utf8",
  );
  const source = readFileSync(
    join(__dirname, "../../src/components/admin/UploadManual.tsx"),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const modules = Object.fromEntries(
    [
      ["react", "react", "react.production.js"],
      ["react/jsx-runtime", "react", "react-jsx-runtime.production.js"],
      ["react-dom", "react-dom", "react-dom.production.js"],
      ["react-dom/client", "react-dom", "react-dom-client.production.js"],
      ["scheduler", "scheduler", "scheduler.production.js"],
    ].map(([id, pkg, name]) => [
      id,
      readFileSync(join(dirname(require.resolve(pkg)), "cjs", name), "utf8"),
    ]),
  );
  modules.manual = compiled;
  const classNames = Object.fromEntries(
    [...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => [
      match[1],
      match[1],
    ]),
  );
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font-family:Arial,sans-serif}*{box-sizing:border-box}${css}</style></head><body><div id="root"></div><script>
    const sources = ${JSON.stringify(modules).replaceAll("<", "\\u003c")};
    const classes = ${JSON.stringify(classNames)};
    const cache = {};
    function require(id) {
      if (id.endsWith('.css')) return classes;
      if (cache[id]) return cache[id].exports;
      if (!sources[id]) throw Error('Unknown real module: ' + id);
      const module = cache[id] = {exports:{}};
      Function('module','exports','require',sources[id])(module,module.exports,require);
      return module.exports;
    }
    const React = require('react');
    function Harness() {
      const [projectId, setProjectId] = React.useState('jd046');
      return React.createElement(React.Fragment,null,
        React.createElement('label',null,'프로젝트 ID',React.createElement('input',{value:projectId,onChange:event=>setProjectId(event.target.value)})),
        React.createElement(require('manual').default,{projectId}));
    }
    require('react-dom/client').createRoot(document.getElementById('root')).render(React.createElement(Harness));
  </script></body></html>`;
  test.beforeEach(async ({ page }) => {
    await page.route("**/admin/", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: html,
      }),
    );
  });
}

async function openManual(page: Page) {
  await page.goto("/admin/");
  const trigger = page.getByRole("button", {
    name: "업로드 매뉴얼",
    exact: true,
  });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "업로드 매뉴얼",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(await trigger.getAttribute("aria-controls")).toBe(
    await dialog.getAttribute("id"),
  );
  return { dialog, trigger };
}

test("newmanual: keyboard opens, traps focus, Escape closes and restores the invoking button", async ({
  page,
}) => {
  await page.goto("/admin/");
  const trigger = page.getByRole("button", {
    name: "업로드 매뉴얼",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "업로드 매뉴얼",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "업로드 매뉴얼", exact: true }),
  ).toBeVisible();
  const close = dialog.getByRole("button", {
    name: "업로드 매뉴얼 닫기",
    exact: true,
  });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((node) => node.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("newmanual: Korean guide explains real preparation, automatic naming and GitHub publishing", async ({
  page,
}) => {
  const { dialog } = await openManual(page);
  for (const text of [
    /편집기 밖에서/,
    /대표 이미지/,
    /본문 이미지/,
    /GLB/,
    /원본.*이름/,
    /재인코딩/,
    /표시 순서/,
    /모바일.*1열/,
    /재사용/,
    /1~4열/,
    /최대 12장/,
    /위로.*아래로/,
    /대체 텍스트/,
    /캡션/,
    /브라우저.*초안/,
    /25\s?MiB/,
    /main/,
    /admin-submissions/,
    /Actions/,
    /소유자.*초대/,
    /저장소 전체/,
    /공개 편집기/,
    /69개/,
    /같은 ZIP/,
    /외부.*리소스/,
    /Draco.*Meshopt.*BasisU/,
  ]) {
    await expect(dialog).toContainText(text);
  }
  await expect(dialog).toContainText("jd046_thumbs.webp");
  await expect(dialog).toContainText("jd046_body_01.jpg");
  await expect(dialog).toContainText("jd046_body_02.png");
  await expect(dialog).toContainText("jd046_model_01.glb");
  await expect(
    dialog.getByRole("link", { name: "GitHub에서 ZIP 업로드" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/jidesign-official/jid/upload/main/admin-submissions",
  );
  await expect(
    dialog.getByRole("link", { name: "Actions 게시 결과 확인" }),
  ).toHaveAttribute("href", "https://github.com/jidesign-official/jid/actions");
  await expect(dialog.locator("input[type=password]")).toHaveCount(0);
});

test("newmanual: filenames follow a valid project ID and fall back safely for invalid IDs", async ({
  page,
}) => {
  await page.goto("/admin/");
  const id = page.getByLabel("프로젝트 ID", { exact: true });
  const trigger = page.getByRole("button", {
    name: "업로드 매뉴얼",
    exact: true,
  });
  // Bypass only the native typing cap to exercise the component's defensive
  // fallback with programmatically supplied state, rather than a truncated ID.
  await id.evaluate(input => input.removeAttribute("maxlength"));
  for (const [value, expected] of [
    ["jd047_detail", "jd047_detail"],
    ["../bad", "jd046"],
    [`jd046_${"a".repeat(75)}`, "jd046"],
  ]) {
    await id.fill(value);
    await trigger.click();
    const dialog = page.getByRole("dialog", {
      name: "업로드 매뉴얼",
      exact: true,
    });
    await expect(dialog).toContainText(`${expected}_thumbs.webp`);
    await expect(dialog).toContainText(`${expected}_body_01.jpg`);
    await page.keyboard.press("Escape");
  }
});

test("newmanual: close button and true backdrop close without losing focus or scroll state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/admin/");
  await page.evaluate(() => {
    document.body.style.overflow = "auto";
    document.documentElement.style.overflow = "clip";
  });
  const trigger = page.getByRole("button", {
    name: "업로드 매뉴얼",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "업로드 매뉴얼",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("heading", { name: "업로드 매뉴얼", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "업로드 매뉴얼 닫기", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.mouse.click(2, 2);
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(
    await page.evaluate(() => [
      document.body.style.overflow,
      document.documentElement.style.overflow,
    ]),
  ).toEqual(["auto", "clip"]);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`newmanual: ${colorScheme} 320px mobile dialog scrolls internally with 44px targets and readable contrast`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 480 });
    await page.emulateMedia({ colorScheme });
    const { dialog, trigger } = await openManual(page);
    const rect = await dialog.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.width).toBeLessThanOrEqual(320);
    expect(rect!.height).toBeLessThanOrEqual(480);
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const target of [
      trigger,
      dialog.getByRole("button", { name: "업로드 매뉴얼 닫기", exact: true }),
    ]) {
      const box = await target.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    const content = dialog.locator("[data-upload-manual-content]");
    expect(
      await content.evaluate((node) => node.scrollHeight > node.clientHeight),
    ).toBe(true);
    await content.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(
      dialog.getByRole("link", { name: "Actions 게시 결과 확인" }),
    ).toBeInViewport();
    const contrast = await content
      .locator("p")
      .first()
      .evaluate((node) => {
        const values = (color: string) =>
          color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number);
        const luminance = (rgb: number[]) =>
          rgb
            .map((value) => {
              const c = value / 255;
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            })
            .reduce(
              (sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i],
              0,
            );
        const foreground = luminance(values(getComputedStyle(node).color));
        const background = luminance(
          values(getComputedStyle(node.closest("dialog")!).backgroundColor),
        );
        return (
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05)
        );
      });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });
}
