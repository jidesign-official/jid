import { expect, test, type Page } from "@playwright/test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, posix } from "node:path";
import ts from "typescript";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const title = "STER SUTTLE";
const regionName = `${title} 연속 이미지`;
const filenames = Array.from({ length: 11 }, (_, index) => `jd038_${index + 2}.jpg`);
const frames = filenames.map((filename) => ({
  filename, src: `/images/portfolio/jd038/${filename}`, width: 730, height: 400, ratio: 730 / 400,
}));
const ordinary = [{ filename: "jd038_1.png", src: "/images/portfolio/jd038/jd038_1.png", width: 842, height: 595, ratio: 842 / 595 }];

// Execute the real TSX with installed React in an isolated browser document.
// No Next build/server, test-only production code, or extra dependencies.
function componentScript() {
  const modules: Record<string, string> = {};
  const packages = ["react", "react-dom", "scheduler"];
  for (const pkg of packages) {
    const folder = dirname(require.resolve(`${pkg}/package.json`));
    const entries = ["index.js", ...(pkg === "react-dom" ? ["client.js"] : [])];
    const cjs = readdirSync(resolve(folder, "cjs")).filter((name) => name.endsWith(".production.js"));
    for (const file of [...entries, ...cjs.map((name) => `cjs/${name}`)]) {
      modules[`${pkg}/${file}`] = readFileSync(resolve(folder, file), "utf8");
    }
  }
  function addSource(id: string) {
    if (modules[id]) return;
    const source = readFileSync(resolve(id), "utf8");
    modules[id] = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    for (const match of modules[id].matchAll(/require\(["']([^"']+)["']\)/g)) {
      const name = match[1];
      if (!name.startsWith(".") && !name.startsWith("@/")) continue;
      const stem = name.startsWith("@/") ? `src/${name.slice(2)}` : posix.normalize(`${posix.dirname(id)}/${name}`);
      const target = [stem, `${stem}.tsx`, `${stem}.ts`].find((file) => existsSync(resolve(file)));
      if (!target) throw new Error(`Cannot resolve ${name} from ${id}`);
      addSource(target);
    }
  }
  addSource("src/components/portfolio/DetailGalleryView.tsx");
  const factories = Object.entries(modules).map(([id, code]) => `${JSON.stringify(id)}:function(require,module,exports){${code}\n}`).join(",\n");
  return `const process={env:{NODE_ENV:'production',NEXT_PUBLIC_BASE_PATH:${JSON.stringify(basePath)}}};
    const modules={${factories}},cache={};
    function load(id){
      if(cache[id])return cache[id].exports;
      if(!modules[id])throw Error('Missing harness module '+id);
      const module={exports:{}};cache[id]=module;
      function req(name){
        let key=name;
        if(name.startsWith('@/'))key='src/'+name.slice(2);
        else if(name.startsWith('.')){
          const parts=(id.slice(0,id.lastIndexOf('/')+1)+name).split('/'),out=[];
          for(const part of parts){if(part==='..')out.pop();else if(part!=='.')out.push(part);}key=out.join('/');
        }else key=name+(name.endsWith('/client')?'.js':'/index.js');
        if(!modules[key])key=[key+'.tsx',key+'.ts',key+'.js'].find(k=>modules[k])||key;
        return load(key);
      }
      modules[id](req,module,module.exports);return module.exports;
    }
    const React=load('react/index.js'), root=load('react-dom/client.js').createRoot(document.getElementById('root'));
    const Gallery=load('src/components/portfolio/DetailGalleryView.tsx').default;
    window.mountGallery=(props)=>root.render(React.createElement(Gallery,props));
    window.unmountGallery=()=>root.unmount();`;
}

async function harness(page: Page, props: Record<string, unknown> = {}, spacer = 0, failedFrames: string[] = []) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/__sequence-harness", (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#root{max-width:960px;margin:auto;padding-top:${spacer}px}.w-full{width:100%}.space-y-6>*+*{margin-top:24px}</style></head><body><div id="root"></div></body></html>`,
  }));
  await page.route("**/images/portfolio/jd038/*", async (route) => {
    const filename = new URL(route.request().url()).pathname.split("/").pop()!;
    if (failedFrames.includes(filename)) {
      await route.fulfill({ status: 404, body: "Missing frame" });
      return;
    }
    await route.fulfill({ path: resolve("public/images/portfolio/jd038", filename) });
  });
  await page.goto("/__sequence-harness");
  await page.addScriptTag({ content: componentScript() });
  // The enabled control proves decoded frames, not the later playback effect.
  // Observe the actual 180ms timer before advancing a frozen browser clock.
  await page.evaluate(() => {
    const nativeInterval = window.setInterval;
    const nativeClear = window.clearInterval;
    const timers = new Set<number>();
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const id = nativeInterval(handler, timeout, ...args);
      if (timeout === 180) timers.add(id);
      return id;
    }) as typeof window.setInterval;
    window.clearInterval = ((id?: number) => { timers.delete(id!); nativeClear(id); }) as typeof window.clearInterval;
    Object.defineProperty(window, "sequencePlaybackTimers", { get: () => timers.size });
  });
  await page.evaluate((props) => {
    (window as unknown as { mountGallery: (props: unknown) => void }).mountGallery(props);
  }, { images: ordinary, sequenceFrames: frames, projectTitle: title, ...props });
  return errors;
}

async function sequence(page: Page) {
  const player = page.getByRole("region", { name: regionName, exact: true });
  await expect(player).toHaveCount(1);
  await player.scrollIntoViewIfNeeded();
  return player;
}

test("jd038 export keeps one eleven-frame sequence after five ordinary images and includes 13 through 16 in the lightbox", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${basePath}/portfolio/jd038`);
  const player = await sequence(page);
  await expect(page.locator("h1")).toHaveText(title);
  await expect(page.getByText("총 16개의 상세 디자인 시안이 등록되어 있습니다.", { exact: false })).toBeVisible();
  const images = page.locator('img[alt="STER SUTTLE 상세 이미지"]');
  const sources = [1, 13, 14, 15, 16].map((index) => `${basePath}/images/portfolio/optimized/jd038/jd038_${index}.webp`);
  await expect(images).toHaveCount(5);
  expect(await images.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("src")))).toEqual(sources);
  expect(await player.evaluate((el) => {
    const images = document.querySelectorAll('img[alt="STER SUTTLE 상세 이미지"]');
    return Boolean(images[images.length - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  for (let index = 1; index < sources.length; index++) {
    await images.nth(index).scrollIntoViewIfNeeded();
    await expect.poll(() => images.nth(index).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 2048 && image.naturalHeight > 0)).toBe(true);
  }
  await images.first().click();
  const expanded = page.locator('img[alt="STER SUTTLE 상세 확대 시안"]');
  await expect(page.getByRole("button", { name: "닫기", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "다음 이미지", exact: true })).toHaveCount(1);
  for (const src of [...sources, sources[0]]) {
    await expect(expanded).toHaveAttribute("src", src);
    await expect.poll(() => expanded.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await page.getByRole("button", { name: "다음 이미지", exact: true }).click();
  }
  await page.getByRole("button", { name: "이전 이미지", exact: true }).click();
  await expect(expanded).toHaveAttribute("src", sources[0]);
  await page.getByRole("button", { name: "이전 이미지", exact: true }).click();
  await expect(expanded).toHaveAttribute("src", sources[sources.length - 1]);
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(expanded).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("jd038 export decodes all eleven originals, plays exact numeric order and wraps without layout shift", async ({ page }) => {
  await freezeTime(page);
  const errors: string[] = [];
  const requested = new Set<string>();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const filename = new URL(request.url()).pathname.split("/").pop()!;
    if (filenames.includes(filename)) requested.add(filename);
  });
  await page.goto(`${basePath}/portfolio/jd038`);
  const player = await sequence(page);
  await expect(player.getByRole("button", { name: "연속 이미지 일시정지", exact: true })).toBeEnabled();
  expect([...requested].sort()).toEqual([...filenames].sort());
  const viewport = player.locator("img").first().locator("..");
  const initialBox = (await viewport.boundingBox())!;
  expect(initialBox.width).toBeCloseTo((await player.boundingBox())!.width, 0);
  expect(initialBox.width / initialBox.height).toBeCloseTo(frames[0].ratio, 2);
  for (const filename of [...filenames, filenames[0]]) {
    const image = player.getByRole("img");
    await expect(image).toHaveAttribute("src", `${basePath}/images/portfolio/jd038/${filename}`);
    expect(await image.evaluate((el) => {
      const frame = el as HTMLImageElement;
      return { complete: frame.complete, width: frame.naturalWidth, height: frame.naturalHeight };
    })).toEqual({ complete: true, width: 730, height: 400 });
    expect((await viewport.boundingBox())!.height).toBeCloseTo(initialBox.height, 1);
    await page.clock.runFor(180);
  }
  await player.getByRole("button", { name: "연속 이미지 일시정지", exact: true }).click();
  const pausedSource = await player.getByRole("img").getAttribute("src");
  await page.clock.runFor(720);
  await expect(player.getByRole("img")).toHaveAttribute("src", pausedSource!);
  await player.getByRole("button", { name: "연속 이미지 재생", exact: true }).click();
  await expect(player.getByRole("button", { name: "연속 이미지 일시정지", exact: true })).toBeEnabled();
  await page.clock.runFor(180);
  await expect(player.getByRole("img")).not.toHaveAttribute("src", pausedSource!);
  expect(errors).toEqual([]);
});

test("harness optional sequence prop leaves other galleries and lightboxes unchanged", async ({ page }) => {
  const errors = await harness(page, { sequenceFrames: undefined });
  await expect(page.getByRole("region", { name: regionName, exact: true })).toHaveCount(0);
  await expect(page.getByText("총 1개의 상세 디자인 시안이 등록되어 있습니다.", { exact: false })).toBeVisible();
  await page.locator('img[alt="STER SUTTLE 상세 이미지"]').click();
  await expect(page.getByRole("button", { name: "닫기", exact: true })).toBeVisible();
  await expect(page.locator('img[alt="STER SUTTLE 상세 확대 시안"]')).toHaveAttribute("src", `${basePath}${ordinary[0].src}`);
  expect(errors).toEqual([]);
});

test("harness renders one sequence region and keeps ordinary gallery count", async ({ page }) => {
  const errors = await harness(page);
  const player = await sequence(page);
  await expect(player.getByRole("img")).toHaveCount(1);
  await expect(page.getByText("총 12개의 상세 디자인 시안이 등록되어 있습니다.", { exact: false })).toBeVisible();
  await expect(page.locator('img[alt="STER SUTTLE 상세 이미지"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("harness decodes all originals near viewport and loops 2 through 12 in exact order", async ({ page }) => {
  const epoch = new Date("2026-01-01T00:00:00Z");
  await page.clock.install({ time: epoch });
  await page.clock.pauseAt(epoch);
  const requests: string[] = [];
  page.on("request", (request) => {
    const filename = new URL(request.url()).pathname.split("/").pop()!;
    if (filenames.includes(filename)) requests.push(filename);
  });
  const errors = await harness(page);
  const player = await sequence(page);
  await expect(player.getByRole("button", { name: "연속 이미지 일시정지", exact: true })).toBeEnabled();
  expect([...new Set(requests)].sort()).toEqual([...filenames].sort());
  await expect.poll(() => page.evaluate(() => (window as unknown as { sequencePlaybackTimers: number }).sequencePlaybackTimers)).toBe(1);
  for (const filename of [...filenames, filenames[0]]) {
    const image = player.getByRole("img");
    await expect(image).toHaveAttribute("src", `${basePath}/images/portfolio/jd038/${filename}`);
    expect(await image.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await page.clock.runFor(180);
  }
  expect(errors).toEqual([]);
});

test("harness requests frames only near viewport and waits for every decode", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeDecode = HTMLImageElement.prototype.decode;
    const pending: (() => void)[] = [];
    HTMLImageElement.prototype.decode = function () {
      return nativeDecode.call(this).then(() => new Promise<void>((resolve) => pending.push(resolve)));
    };
    Object.defineProperty(window, "pendingDecodes", { get: () => pending.length });
    (window as unknown as { releaseDecodes: () => void }).releaseDecodes = () => pending.splice(0).forEach((resolve) => resolve());
  });
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/jd038_\d+\.jpg$/.test(request.url())) requests.push(request.url());
  });
  await harness(page, {}, 3000);
  await page.waitForTimeout(250);
  expect(requests).toEqual([]);
  const player = await sequence(page);
  await expect.poll(() => requests.length).toBe(11);
  await expect.poll(() => page.evaluate(() => (window as unknown as { pendingDecodes: number }).pendingDecodes)).toBe(11);
  await expect(player.getByRole("button", { name: "연속 이미지 일시정지", exact: true })).toHaveCount(0);
  await page.waitForTimeout(400);
  await page.evaluate(() => (window as unknown as { releaseDecodes: () => void }).releaseDecodes());
  await expect(player.getByRole("button", { name: "연속 이미지 일시정지", exact: true })).toBeEnabled();
});

async function freezeTime(page: Page) {
  const epoch = new Date("2026-01-01T00:00:00Z");
  await page.clock.install({ time: epoch });
  await page.clock.pauseAt(epoch);
}

test("harness pause/resume preserves the frame and pauses offscreen and while document hidden", async ({ page }) => {
  await freezeTime(page);
  const errors = await harness(page, {}, 3000);
  const player = await sequence(page);
  await expect(player.getByRole("button", { name: "연속 이미지 일시정지", exact: true })).toBeEnabled();
  await page.clock.runFor(180);
  const image = player.getByRole("img");
  await expect(image).toHaveAttribute("src", `${basePath}${frames[1].src}`);
  await player.getByRole("button", { name: "연속 이미지 일시정지", exact: true }).click();
  await expect(player.getByRole("button", { name: "연속 이미지 재생", exact: true })).toBeEnabled();
  await page.clock.runFor(720);
  await expect(image).toHaveAttribute("src", `${basePath}${frames[1].src}`);
  await player.getByRole("button", { name: "연속 이미지 재생", exact: true }).click();
  await page.clock.runFor(180);
  await expect(image).toHaveAttribute("src", `${basePath}${frames[2].src}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.clock.runFor(720);
  await expect(image).toHaveAttribute("src", `${basePath}${frames[2].src}`);
  await player.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await page.clock.runFor(180);
  await expect(image).toHaveAttribute("src", `${basePath}${frames[3].src}`);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(720);
  await expect(image).toHaveAttribute("src", `${basePath}${frames[3].src}`);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(180);
  await expect(image).toHaveAttribute("src", `${basePath}${frames[4].src}`);
  expect(errors).toEqual([]);
});

test("harness reduced motion defaults paused, allows explicit play and respects live preference changes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await freezeTime(page);
  const errors = await harness(page);
  const player = await sequence(page);
  const play = player.getByRole("button", { name: "연속 이미지 재생", exact: true });
  await expect(play).toBeEnabled();
  await page.clock.runFor(720);
  await expect(player.getByRole("img")).toHaveAttribute("src", `${basePath}${frames[0].src}`);
  await play.click();
  await page.clock.runFor(180);
  await expect(player.getByRole("img")).toHaveAttribute("src", `${basePath}${frames[1].src}`);
  await page.evaluate(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changes: boolean[] = [];
    media.addEventListener("change", () => changes.push(media.matches));
    Object.defineProperty(window, "motionChanges", { get: () => changes });
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // WebKit dispatches these asynchronously and coalesces back-to-back changes.
  // Observe each actual notification rather than toggling twice in one render.
  await expect.poll(() => page.evaluate(() => (window as unknown as { motionChanges: boolean[] }).motionChanges)).toEqual([false]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => page.evaluate(() => (window as unknown as { motionChanges: boolean[] }).motionChanges)).toEqual([false, true]);
  await expect(play).toBeEnabled();
  await page.clock.runFor(720);
  await expect(player.getByRole("img")).toHaveAttribute("src", `${basePath}${frames[1].src}`);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(player.getByRole("button", { name: "연속 이미지 일시정지", exact: true })).toBeEnabled();
  await page.clock.runFor(180);
  await expect(player.getByRole("img")).toHaveAttribute("src", `${basePath}${frames[2].src}`);
  expect(errors).toEqual([]);
});

test("harness keeps the first-frame aspect ratio across every differently sized frame and mobile resize", async ({ page }) => {
  await freezeTime(page);
  const errors = await harness(page);
  const player = await sequence(page);
  await expect(player.getByRole("button", { name: "연속 이미지 일시정지", exact: true })).toBeEnabled();
  for (const width of [1280, 380]) {
    await page.setViewportSize({ width, height: 900 });
    await player.scrollIntoViewIfNeeded();
    const viewport = player.locator("img").first().locator("..");
    const before = (await viewport.boundingBox())!;
    const playerBox = (await player.boundingBox())!;
    expect(before.width).toBeCloseTo(playerBox.width, 0);
    expect(before.width / before.height).toBeCloseTo(frames[0].ratio, 2);
    for (let index = 0; index < frames.length; index++) {
      const image = player.getByRole("img");
      await expect(image).toHaveCSS("object-fit", "contain");
      expect((await viewport.boundingBox())!.height).toBeCloseTo(before.height, 1);
      await page.clock.runFor(180);
    }
    const buttonBox = (await player.getByRole("button", { name: "연속 이미지 일시정지", exact: true }).boundingBox())!;
    expect(buttonBox.width).toBeGreaterThanOrEqual(44);
    expect(buttonBox.height).toBeGreaterThanOrEqual(44);
    await expect(player.getByText(/프레임 \d+ \/ 11/)).toHaveAttribute("aria-live", "off");
  }
  expect(errors).toEqual([]);
});

for (const failed of ["jd038_7.jpg", "jd038_2.jpg"]) {
  test(`harness ${failed} failure preserves first available frame with accessible fallback`, async ({ page }) => {
    await freezeTime(page);
    const requests: string[] = [];
    page.on("request", (request) => {
      const filename = new URL(request.url()).pathname.split("/").pop()!;
      if (filenames.includes(filename)) requests.push(filename);
    });
    const errors = await harness(page, {}, 0, [failed]);
    const player = await sequence(page);
    await expect(player.getByRole("status")).toContainText("연속 이미지 일부를 불러오지 못했습니다");
    const available = failed === filenames[0] ? frames[1] : frames[0];
    await expect(player.getByRole("img")).toHaveAttribute("src", `${basePath}${available.src}`);
    await page.clock.runFor(900);
    await expect(player.getByRole("img")).toHaveAttribute("src", `${basePath}${available.src}`);
    await expect(player.getByRole("button", { name: "연속 이미지 재생", exact: true })).toBeDisabled();
    expect([...new Set(requests)].sort()).toEqual([...filenames].sort());
    expect(errors).toEqual([]);
  });
}

test("harness clears its playback timer and observers on unmount", async ({ page }) => {
  await page.addInitScript(() => {
    const originalInterval = window.setInterval;
    const originalClear = window.clearInterval;
    const active = new Set<number>();
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const id = originalInterval(handler, timeout, ...args);
      if (timeout === 180) active.add(id);
      return id;
    }) as typeof window.setInterval;
    window.clearInterval = ((id?: number) => { active.delete(id!); originalClear(id); }) as typeof window.clearInterval;
    Object.defineProperty(window, "sequenceTimers", { get: () => active.size });
    const NativeObserver = window.IntersectionObserver;
    const observers = new Set<IntersectionObserver>();
    window.IntersectionObserver = class extends NativeObserver {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super(callback, options);
        observers.add(this);
      }
      disconnect() { observers.delete(this); super.disconnect(); }
    };
    Object.defineProperty(window, "sequenceObservers", { get: () => observers.size });
  });
  const errors = await harness(page);
  const player = await sequence(page);
  await expect(player.getByRole("button", { name: "연속 이미지 일시정지", exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => (window as unknown as { sequenceTimers: number }).sequenceTimers)).toBe(1);
  await page.evaluate(() => (window as unknown as { unmountGallery: () => void }).unmountGallery());
  await expect.poll(() => page.evaluate(() => (window as unknown as { sequenceTimers: number }).sequenceTimers)).toBe(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { sequenceObservers: number }).sequenceObservers)).toBe(0);
  await page.waitForTimeout(400);
  expect(errors).toEqual([]);
});


test("harness decoded controls do not prove playback until the visibility observer settles", async ({ page }) => {
  await freezeTime(page);
  await page.addInitScript(() => {
    const NativeObserver = window.IntersectionObserver;
    const pending: (() => void)[] = [];
    window.IntersectionObserver = class extends NativeObserver {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super((entries, observer) => {
          if (options?.rootMargin) callback(entries, observer);
          // Hold the playback observer's visible notification explicitly;
          // preload intersection still uses the real browser geometry.
          else pending.push(() => callback(entries.map((entry) => ({ ...entry, isIntersecting: true })), observer));
        }, options);
      }
    };
    (window as unknown as { releaseSequenceVisibility: () => void }).releaseSequenceVisibility = () => pending.splice(0).forEach((callback) => callback());
  });
  const errors = await harness(page);
  const player = await sequence(page);
  await expect(player.getByRole("button", { name: "연속 이미지 일시정지", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { sequencePlaybackTimers: number }).sequencePlaybackTimers)).toBe(0);
  // Reproduce the full-run failure: advancing before viewport readiness leaves
  // the first decoded frame unchanged even though the pause button is enabled.
  await page.clock.runFor(180);
  await expect(player.getByRole("img")).toHaveAttribute("src", `${basePath}${frames[0].src}`);
  await page.evaluate(() => (window as unknown as { releaseSequenceVisibility: () => void }).releaseSequenceVisibility());
  await expect.poll(() => page.evaluate(() => (window as unknown as { sequencePlaybackTimers: number }).sequencePlaybackTimers)).toBe(1);
  await page.clock.runFor(180);
  await expect(player.getByRole("img")).toHaveAttribute("src", `${basePath}${frames[1].src}`);
  expect(errors).toEqual([]);
});
