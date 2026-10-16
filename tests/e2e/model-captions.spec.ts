import { test, expect } from "@playwright/test";
import { modelProjects } from "./helpers/model-cases";
import expectedTitles from "./fixtures/portfolio-titles.json";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

for (const { id, files } of modelProjects) {
  test(`${id}: all 3D viewers omit format captions and have unique accessible names and controls`, async ({ page }) => {
    await page.goto(`${basePath}/portfolio/${id}/`);
    const title = expectedTitles[id as keyof typeof expectedTitles];
    const viewers = page.getByRole("region", { name: /.+ 3D 모델$/ });
    await expect(viewers).toHaveCount(files.length);
    for (let index = 0; index < files.length; index++) {
      const projectTitle = files.length > 1 ? `${title} — 모델 ${index + 1}` : title;
      const viewer = page.getByRole("region", { name: `${projectTitle} 3D 모델`, exact: true });
      await expect(viewer).toHaveCount(1);
      // Assert document order, not just the presence of each distinct region.
      await expect(viewers.nth(index)).toHaveAttribute("aria-label", `${projectTitle} 3D 모델`);
      await expect(viewer).not.toContainText(/GLB/i);
      await expect(viewer.getByRole("heading", { name: "3D 모델링 뷰어", exact: true })).toHaveCount(1);
      await expect(viewer.getByRole("button", { name: /자동 회전/ })).toHaveCount(1);
      await expect(viewer.getByRole("button", { name: "시점 리셋", exact: true })).toHaveCount(1);
      await expect(viewer.getByRole("button", { name: "전체화면", exact: true })).toHaveCount(1);
    }
  });
}
