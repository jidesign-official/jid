import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

type SettingsApi = typeof import("../../src/lib/portfolioSettings");

// Use Playwright's CommonJS TypeScript hook on both Node 20 and newer Node.
// Its Node 20 async ESM loader can preserve exports while reporting CommonJS.
const requireModule = createRequire(__filename);
const root = path.resolve(__dirname, "../..");
const featured = ["jd025_c", "jd008_b", "jd005_b", "jd013"];
const ids = ["jd038", ...featured, "jd002", "jd099"];
const draft = () => ({ schemaVersion: 1 as const, order: ["jd002"], hidden: ["jd099"], featured: [...featured] });

const qa = process.env.PORTFOLIO_SETTINGS_QA_ROOT || path.join(process.env.RUNNER_TEMP || process.env.TMPDIR || path.resolve(__dirname, "../../test-results"), "portfolio-settings");
const temporaryRoots: string[] = [];
function fixtureRoot() {
  fs.mkdirSync(qa, { recursive: true });
  const directory = fs.mkdtempSync(path.join(qa, "backend-fixture-"));
  temporaryRoots.push(directory);
  return directory;
}
test.afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function settingsApi() {
  // Feature absence must fail here, not as a mistyped module import.
  expect(fs.existsSync(path.join(root, "src/lib/portfolioSettings.ts")), "client-safe settings module exists").toBe(true);
  return requireModule("../../src/lib/portfolioSettings") as SettingsApi;
}

async function managementApi() {
  expect(fs.existsSync(path.join(root, "src/lib/portfolioManagement.ts")), "server management module exists").toBe(true);
  return requireModule("../../src/lib/portfolioManagement") as typeof import("../../src/lib/portfolioManagement");
}

async function managementWithFs(overrides: Partial<typeof fs>) {
  const dependencies: Record<string, unknown> = {
    "node:fs": { ...fs, ...overrides }, "node:path": path,
    "./portfolioCatalog": requireModule("../../src/lib/portfolioCatalog") as typeof import("../../src/lib/portfolioCatalog"),
    "./portfolioOrdering": requireModule("../../src/lib/portfolioOrdering") as typeof import("../../src/lib/portfolioOrdering"),
    "./portfolioSettings": await settingsApi(),
  };
  const source = fs.readFileSync(path.join(root, "src/lib/portfolioManagement.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} as typeof import("../../src/lib/portfolioManagement") };
  vm.runInNewContext(compiled, {
    module: loaded, exports: loaded.exports, Buffer, TextDecoder, process,
    require: (id: string) => {
      if (!Object.hasOwn(dependencies, id)) throw new Error(`Unexpected management dependency: ${id}`);
      return dependencies[id];
    },
  }, { filename: "portfolioManagement.test.cjs" });
  return loaded.exports;
}

async function rejectsValue(value: unknown, projectIds: readonly string[] = ids) {
  const api: SettingsApi = await settingsApi();
  expect(() => api.validatePortfolioSettings(value, projectIds)).toThrow(/[가-힣]/);
  expect(() => api.normalizePortfolioSettings(value as never, projectIds)).toThrow(/[가-힣]/);
  expect(() => api.serializePortfolioSettings(value as never, projectIds)).toThrow(/[가-힣]/);
  const source = JSON.stringify(value);
  if (source !== undefined) expect(() => api.parsePortfolioSettings(source, projectIds)).toThrow(/[가-힣]/);
}

for (const [name, value] of [
  ["null", null], ["array", []], ["string", "settings"], ["number", 1],
  ["missing key", { schemaVersion: 1, order: [], featured }],
  ["extra key", { ...draft(), title: "no metadata" }],
  ["nested schema", { settings: draft() }],
  ["string version", { ...draft(), schemaVersion: "1" }],
  ["wrong version", { ...draft(), schemaVersion: 2 }],
] as const) {
  test(`strict flat schema rejects ${name}`, async () => { await rejectsValue(value); });
}

for (const list of ["order", "hidden", "featured"] as const) {
  for (const [name, bad] of [
    ["non-array", "jd002"], ["null", null], ["object", {}],
    ["number ID", [2]], ["null ID", [null]], ["nested ID", [["jd002"]]],
    ["unknown ID", ["jd999"]], ["uppercase ID", ["JD002"]],
    ["whitespace ID", [" jd002"]], ["unicode digits", ["jd００２"]],
    ["path ID", ["../jd002"]], ["long ID", ["jd002_" + "a".repeat(75)]],
    ["duplicate IDs", ["jd002", "jd002"]],
    ["over 1000 IDs", Array(1001).fill("jd002")],
  ] as const) {
    test(`${list} rejects ${name}`, async () => { await rejectsValue({ ...draft(), [list]: bad }); });
  }
}

for (const [name, badIds] of [
  ["duplicate IDs", [...ids, ids[0]]], ["unknown ID format", [...ids, "jd999/asset"]],
  ["overlong ID", [...ids, "jd999_" + "a".repeat(75)]],
  ["over 1000 IDs", Array.from({ length: 1001 }, (_, i) => `jd999_${"a".repeat(Math.floor(i / 26) + 1)}${String.fromCharCode(97 + i % 26)}`)],
] as const) {
  test(`catalog rejects ${name}`, async () => { await rejectsValue(draft(), badIds); });
}

test("catalog rejects sparse ID arrays", async () => {
  const sparse = [...ids];
  sparse.length++;
  await rejectsValue(draft(), sparse);
});

for (const count of [0, 1, 2, 3, 5]) {
  test(`featured rejects ${count} selections`, async () => {
    await rejectsValue({ ...draft(), featured: [...featured, "jd002"].slice(0, count) });
  });
}

test("hidden featured IDs must be replaced explicitly", async () => {
  await rejectsValue({ ...draft(), hidden: [featured[0]] });
});

for (const [name, source] of [
  ["malformed JSON", "{"], ["empty JSON", ""], ["trailing comma", '{"schemaVersion":1,}'],
  ["duplicate order", JSON.stringify(draft()).replace('"order":["jd002"]', '"order":[],"order":["jd002"]')],
  ["escaped duplicate key", JSON.stringify(draft()).replace('"hidden":["jd099"]', '"hidden":[],"hidd\\u0065n":["jd099"]')],
  ["escaped first alias", JSON.stringify(draft()).replace('"schemaVersion":1', '"schema\\u0056ersion":1,"schemaVersion":1')],
] as const) {
  test(`parser rejects ${name}`, async () => {
    const api: SettingsApi = await settingsApi();
    expect(() => api.parsePortfolioSettings(source, ids)).toThrow(/[가-힣]/);
  });
}

test("parser enforces UTF-8 64 KiB before parsing", async () => {
  const api: SettingsApi = await settingsApi();
  const source = JSON.stringify(draft());
  const exact = source + " ".repeat(api.MAX_PORTFOLIO_SETTINGS_BYTES - Buffer.byteLength(source));
  expect(api.parsePortfolioSettings(exact, ids)).toEqual(api.normalizePortfolioSettings(draft(), ids));
  expect(() => api.parsePortfolioSettings(exact + " ", ids)).toThrow(/64\s*KiB/);
  const multibyte = JSON.stringify({ ...draft(), note: "가".repeat(22000) });
  expect(multibyte.length).toBeLessThan(65536);
  expect(Buffer.byteLength(multibyte)).toBeGreaterThan(65536);
  expect(() => api.parsePortfolioSettings(multibyte, ids)).toThrow(/64\s*KiB/);
});

test("export enforces UTF-8 bound after full-order expansion", async () => {
  const api: SettingsApi = await settingsApi();
  const longIds = Array.from({ length: 996 }, (_, i) => `jd${String(i).padStart(3, "0")}_${"a".repeat(74)}`);
  const catalog = [...featured, ...longIds];
  const value = { schemaVersion: 1 as const, order: [], hidden: [], featured: [...featured] };
  api.validatePortfolioSettings(value, catalog);
  expect(() => api.serializePortfolioSettings(value, catalog)).toThrow(/64\s*KiB/);
});

test("isolated defaults preserve the 69-project legacy baseline and current four", async () => {
  const { getPortfolioManagement } = await managementApi();
  const { getPortfolioCatalog } = requireModule("../../src/lib/portfolioCatalog") as typeof import("../../src/lib/portfolioCatalog");
  const { sortPortfolioProjects } = requireModule("../../src/lib/portfolioOrdering") as typeof import("../../src/lib/portfolioOrdering");
  const isolated = fixtureRoot();
  const raw = getPortfolioCatalog(isolated);
  const original = structuredClone(raw);
  const baseline = sortPortfolioProjects(raw, isolated);
  const management = getPortfolioManagement(isolated);
  expect(raw).toHaveLength(69);
  expect(new Set(raw.map(project => project.id)).size).toBe(69);
  expect(baseline[0].id).toBe("jd038");
  expect(management.allProjects).toEqual(baseline);
  expect(management.projects).toEqual(baseline);
  expect(management.featuredProjects.map(project => project.id)).toEqual(featured);
  expect(management.settings).toEqual({ schemaVersion: 1, order: baseline.map(project => project.id), hidden: [], featured });
  expect(raw).toEqual(original);
  expect(getPortfolioCatalog(isolated)).toEqual(original);
});

test("isolated root controls baseline model resolution without changing the raw catalog", async () => {
  const { getPortfolioManagement } = await managementApi();
  const { getPortfolioCatalog } = requireModule("../../src/lib/portfolioCatalog") as typeof import("../../src/lib/portfolioCatalog");
  const { sortPortfolioProjects } = requireModule("../../src/lib/portfolioOrdering") as typeof import("../../src/lib/portfolioOrdering");
  const isolated = fixtureRoot();
  const raw = getPortfolioCatalog(isolated);
  const original = structuredClone(raw);
  const expected = [...raw.filter(project => project.id === "jd038"), ...raw.filter(project => project.id !== "jd038")];
  expect(sortPortfolioProjects(raw, isolated)).toEqual(expected);
  expect(getPortfolioManagement(isolated).allProjects).toEqual(expected);
  expect(raw).toEqual(original);
  expect(getPortfolioCatalog(isolated)).toEqual(original);
});

test("manual order, reversible hiding, and image-only featured projects resolve independently", async () => {
  const { getPortfolioManagement } = await managementApi();
  const { getPortfolioCatalog } = requireModule("../../src/lib/portfolioCatalog") as typeof import("../../src/lib/portfolioCatalog");
  const { getProjectModelPaths } = requireModule("../../src/lib/portfolioModels") as typeof import("../../src/lib/portfolioModels");
  const isolated = fixtureRoot();
  const raw = structuredClone(getPortfolioCatalog(isolated));
  const baseline = getPortfolioManagement(isolated).allProjects;
  const value = { schemaVersion: 1, order: ["jd002", "jd038"], hidden: ["jd038"], featured: ["jd002", ...featured.slice(0, 3)] };
  fs.writeFileSync(path.join(isolated, "portfolio-settings.json"), JSON.stringify(value));
  const hidden = getPortfolioManagement(isolated);
  expect(hidden.allProjects).toEqual(baseline);
  expect(hidden.settings.order).toEqual([...value.order, ...baseline.map(project => project.id).filter(id => !value.order.includes(id))]);
  expect(hidden.projects.map(project => project.id)).toEqual(hidden.settings.order.filter(id => id !== "jd038"));
  expect(hidden.projects).toHaveLength(68);
  expect(hidden.featuredProjects.map(project => project.id)).toEqual(value.featured);
  expect(getProjectModelPaths("jd002", root)).toEqual([]);
  expect(hidden.featuredProjects[0]).toEqual(raw.find(project => project.id === "jd002"));
  fs.writeFileSync(path.join(isolated, "portfolio-settings.json"), JSON.stringify({ ...value, hidden: [] }));
  const restored = getPortfolioManagement(isolated);
  expect(restored.settings.order).toEqual(hidden.settings.order);
  expect(restored.projects.map(project => project.id)).toEqual(restored.settings.order);
  expect(restored.projects[1].id).toBe("jd038");
  expect(getPortfolioCatalog(isolated)).toEqual(raw);
});

for (const kind of ["directory", "symlink", "dangling symlink"] as const) {
  test(`server file validation rejects ${kind}`, async () => {
    const { getPortfolioManagement } = await managementApi();
    const isolated = fixtureRoot();
    const filename = path.join(isolated, "portfolio-settings.json");
    if (kind === "directory") fs.mkdirSync(filename);
    else {
      const target = path.join(isolated, "target.json");
      if (kind === "symlink") fs.writeFileSync(target, JSON.stringify({ ...draft(), order: [], hidden: [] }));
      fs.symlinkSync(target, filename);
    }
    expect(() => getPortfolioManagement(isolated)).toThrow(/일반 파일|심볼릭/);
  });
}

for (const mutation of ["replacement file", "replacement symlink", "disappearance"] as const) {
  test(`server file validation rejects TOCTOU ${mutation}`, async () => {
    const isolated = fixtureRoot();
    const filename = path.join(isolated, "portfolio-settings.json");
    fs.writeFileSync(filename, JSON.stringify({ ...draft(), order: [], hidden: [] }));
    const replacement = path.join(isolated, "replacement.json");
    fs.writeFileSync(replacement, fs.readFileSync(filename));
    const { getPortfolioManagement } = await managementWithFs({
      openSync: ((...args: Parameters<typeof fs.openSync>) => {
        if (args[0] === filename) {
          fs.unlinkSync(filename);
          if (mutation === "replacement file") fs.renameSync(replacement, filename);
          if (mutation === "replacement symlink") fs.symlinkSync(replacement, filename);
        }
        return fs.openSync(...args);
      }) as typeof fs.openSync,
    });
    expect(() => getPortfolioManagement(isolated)).toThrow(/[가-힣]/);
  });
}

test("server file validation bounds actual reads even if stat size is stale", async () => {
  const isolated = fixtureRoot();
  const filename = path.join(isolated, "portfolio-settings.json");
  fs.writeFileSync(filename, JSON.stringify({ ...draft(), order: [], hidden: [] }) + " ".repeat(65536));
  const stale = new Proxy(fs.statSync(filename), { get: (target, key) => key === "size" ? 1 : Reflect.get(target, key) });
  const capacities: number[] = [];
  const { getPortfolioManagement } = await managementWithFs({
    lstatSync: (() => stale) as unknown as typeof fs.lstatSync,
    fstatSync: (() => stale) as unknown as typeof fs.fstatSync,
    readSync: ((fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
      capacities.push(buffer.byteLength, length);
      return fs.readSync(fd, buffer, offset, length, position);
    }) as typeof fs.readSync,
  });
  expect(() => getPortfolioManagement(isolated)).toThrow(/64\s*KiB/);
  expect(capacities.length).toBeGreaterThan(0);
  expect(Math.max(...capacities)).toBeLessThanOrEqual(65537);
});

test("server file validation fails closed on unreadable lstat", async () => {
  const isolated = fixtureRoot();
  const { getPortfolioManagement } = await managementWithFs({
    lstatSync: (() => { throw Object.assign(new Error("denied"), { code: "EACCES" }); }) as typeof fs.lstatSync,
  });
  expect(() => getPortfolioManagement(isolated)).toThrow(/[가-힣]/);
});

test("literal initial-settings fixture preserves unchanged defaults at an isolated root", async () => {
  const api: SettingsApi = await settingsApi();
  const { getPortfolioManagement } = await managementApi();
  const isolated = fixtureRoot();
  const defaults = getPortfolioManagement(isolated);
  const filename = path.join(isolated, api.PORTFOLIO_SETTINGS_FILENAME);
  fs.copyFileSync(path.join(__dirname, "fixtures/initial-settings.json"), filename);
  expect(JSON.parse(fs.readFileSync(filename, "utf8"))).toEqual({ schemaVersion: 1, order: [], hidden: [], featured });
  expect(getPortfolioManagement(isolated)).toEqual(defaults);
});

test("checked-out publication settings resolve against the complete current catalog", async () => {
  const api: SettingsApi = await settingsApi();
  const { getPortfolioManagement } = await managementApi();
  const { getPortfolioCatalog } = requireModule("../../src/lib/portfolioCatalog") as typeof import("../../src/lib/portfolioCatalog");
  const { sortPortfolioProjects } = requireModule("../../src/lib/portfolioOrdering") as typeof import("../../src/lib/portfolioOrdering");
  // npm's pretest hook imports this checkout's real ZIPs before this validation.
  // Default-content oracles belong only to isolated fixtures, never this root.
  const baseline = sortPortfolioProjects(getPortfolioCatalog(root), root);
  const baselineIds = baseline.map(project => project.id);
  const filename = path.join(root, api.PORTFOLIO_SETTINGS_FILENAME);
  const expected = fs.existsSync(filename)
    ? api.parsePortfolioSettings(fs.readFileSync(filename, "utf8"), baselineIds)
    : api.createDefaultPortfolioSettings(baselineIds);
  const management = getPortfolioManagement(root);
  const byId = new Map(baseline.map(project => [project.id, project]));
  expect(management.allProjects).toEqual(baseline);
  expect(management.settings).toEqual(expected);
  expect(management.projects).toEqual(expected.order.filter(id => !expected.hidden.includes(id)).map(id => byId.get(id)));
  expect(management.featuredProjects).toEqual(expected.featured.map(id => byId.get(id)));
});

test("client-safe settings execute without any Node imports or globals", async () => {
  await settingsApi();
  const source = fs.readFileSync(path.join(root, "src/lib/portfolioSettings.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {} as Awaited<ReturnType<typeof settingsApi>>;
  vm.runInNewContext(compiled, { exports, TextEncoder, require: (id: string) => { throw new Error(`Client imported ${id}`); } });
  expect(exports.parsePortfolioSettings(exports.serializePortfolioSettings(draft(), ids), ids)).toEqual(exports.normalizePortfolioSettings(draft(), ids));
});

test("boundary catalog accepts 1000 valid IDs and 80-character ASCII IDs", async () => {
  const api: SettingsApi = await settingsApi();
  const catalog = [...featured, ...Array.from({ length: 996 }, (_, i) => `jd${String(i).padStart(3, "0")}_a`)];
  const value = { schemaVersion: 1 as const, order: [...catalog], hidden: catalog.slice(4), featured: [...featured] };
  expect(api.parsePortfolioSettings(api.serializePortfolioSettings(value, catalog), catalog)).toEqual(value);
  const longest = "jd999_" + "a".repeat(74);
  expect(longest).toHaveLength(80);
  api.validatePortfolioSettings({ ...draft(), order: [longest] }, [...ids, longest]);
});

for (const bad of ["jd002\n", "jd002\r", "jd002\u2028", "jd002_", "jd2", "jd002_a1", "jd002_a-b", "jd002_Ab", "ｊｄ002"]) {
  test(`catalog rejects literal noncanonical ID ${JSON.stringify(bad)}`, async () => {
    await rejectsValue({ ...draft(), order: [bad] }, [...ids, bad]);
  });
}

test("normalization accepts frozen arrays and appends new IDs in baseline order", async () => {
  const api: SettingsApi = await settingsApi();
  const value = draft();
  Object.freeze(value.order); Object.freeze(value.hidden); Object.freeze(value.featured); Object.freeze(value);
  const previous = api.normalizePortfolioSettings(value, Object.freeze([...ids]));
  const expanded = api.normalizePortfolioSettings(previous, Object.freeze(["jd998", ...ids, "jd997"]));
  expect(expanded.order).toEqual([...previous.order, "jd998", "jd997"]);
  expect(previous.order).not.toContain("jd998");
});

test("CMS additions append without resetting stored order and can be image-only featured", async () => {
  const { getPortfolioManagement } = await managementApi();
  const { getPortfolioCatalog } = requireModule("../../src/lib/portfolioCatalog") as typeof import("../../src/lib/portfolioCatalog");
  const isolated = fixtureRoot();
  const previous = getPortfolioManagement(isolated);
  const filename = path.join(isolated, "portfolio-settings.json");
  fs.writeFileSync(filename, JSON.stringify(previous.settings));
  const project = {
    id: "jd900", folder: "jd900", title: "CMS images only", category: "Product",
    packageSha256: "a".repeat(64), image: "/_admin_media/jd900/aaaaaaaaaaaaaaaa/cover.webp", blocks: [], models: [],
  };
  fs.mkdirSync(path.join(isolated, ".generated"));
  const registry = path.join(isolated, ".generated/admin-projects.json");
  fs.writeFileSync(registry, JSON.stringify({ schemaVersion: 1, projects: [project] }));
  const appended = getPortfolioManagement(isolated);
  expect(appended.allProjects).toHaveLength(70);
  expect(appended.settings.order).toEqual([...previous.settings.order, "jd900"]);
  expect(getPortfolioCatalog(isolated).at(-1)?.id).toBe("jd900");
  const value = { ...appended.settings, featured: ["jd900", ...featured.slice(0, 3)] };
  fs.writeFileSync(filename, JSON.stringify(value));
  expect(getPortfolioManagement(isolated).featuredProjects.map(item => item.id)).toEqual(value.featured);
  fs.writeFileSync(registry, JSON.stringify({ schemaVersion: 1, projects: [] }));
  expect(() => getPortfolioManagement(isolated)).toThrow(/참조.*수정/);
});

for (const [name, source] of [
  ["malformed", "{"], ["unknown field", JSON.stringify({ ...draft(), extra: true })],
  ["fewer featured", JSON.stringify({ ...draft(), featured: featured.slice(1) })],
  ["hidden featured", JSON.stringify({ ...draft(), hidden: [featured[0]] })],
  ["removed ID", JSON.stringify({ ...draft(), order: ["jd999"] })],
  ["duplicate escaped key", JSON.stringify({ ...draft(), order: [], hidden: [] }).replace('"order":[]', '"order":[],"or\\u0064er":[]')],
  ["oversize", " ".repeat(65537)],
] as const) {
  test(`present invalid root settings never fall back: ${name}`, async () => {
    const { getPortfolioManagement } = await managementApi();
    const isolated = fixtureRoot();
    fs.mkdirSync(path.join(isolated, "admin-submissions"));
    fs.writeFileSync(path.join(isolated, "admin-submissions/portfolio-settings.json"), JSON.stringify({ ...draft(), order: [], hidden: [] }));
    fs.writeFileSync(path.join(isolated, "portfolio-settings.json"), source);
    expect(() => getPortfolioManagement(isolated)).toThrow(/[가-힣]/);
  });
}

test("missing root settings ignore similarly named nested files", async () => {
  const { getPortfolioManagement } = await managementApi();
  const isolated = fixtureRoot();
  fs.mkdirSync(path.join(isolated, "admin-submissions"));
  fs.writeFileSync(path.join(isolated, "admin-submissions/portfolio-settings.json"), "not JSON");
  expect(getPortfolioManagement(isolated).featuredProjects.map(project => project.id)).toEqual(featured);
});

test("baseline sorting keeps pinned/model-count/byte-size/stable-tie rules at an isolated root", async () => {
  const { sortPortfolioProjects } = requireModule("../../src/lib/portfolioOrdering") as typeof import("../../src/lib/portfolioOrdering");
  const isolated = fixtureRoot();
  const folder = path.join(isolated, "public/images/glb");
  fs.mkdirSync(folder, { recursive: true });
  for (const [name, size] of [["jd001_web.glb", 5], ["jd003_web.glb", 5], ["jd023-001_web.glb", 100], ["jd023-002_web.glb", 100], ["jd023-003_web.glb", 100], ["jd004_a_web.glb", 3]] as const) {
    // Byte stubs are sorting-only probes; no model validator or renderer is invoked.
    fs.writeFileSync(path.join(folder, name), Buffer.alloc(size));
  }
  const projects = ["jd003", "jd001", "jd099", "jd098", "jd023", "jd004_a", "jd038"].map(id => Object.freeze({ id }));
  Object.freeze(projects);
  expect(sortPortfolioProjects(projects, isolated).map(project => project.id)).toEqual(["jd038", "jd023", "jd004_a", "jd003", "jd001", "jd099", "jd098"]);
});

test("server rejects malformed UTF-8 instead of silently replacing bytes", async () => {
  const { getPortfolioManagement } = await managementApi();
  const isolated = fixtureRoot();
  fs.writeFileSync(path.join(isolated, "portfolio-settings.json"), Buffer.concat([Buffer.from('{"schemaVersion":1,"order":[],"hidden":[],"featured":["'), Buffer.from([0xff]), Buffer.from('"]}') ]));
  expect(() => getPortfolioManagement(isolated)).toThrow(/[가-힣]/);
});

test("server accepts a present file at the exact 64 KiB boundary", async () => {
  const { getPortfolioManagement } = await managementApi();
  const isolated = fixtureRoot();
  const source = JSON.stringify({ schemaVersion: 1, order: [], hidden: [], featured });
  fs.writeFileSync(path.join(isolated, "portfolio-settings.json"), source + " ".repeat(65536 - Buffer.byteLength(source)));
  expect(getPortfolioManagement(isolated).projects).toHaveLength(69);
});

test("oversize stat prevents opening or allocating from the settings file", async () => {
  const isolated = fixtureRoot();
  fs.writeFileSync(path.join(isolated, "portfolio-settings.json"), " ".repeat(65537));
  let opens = 0;
  const { getPortfolioManagement } = await managementWithFs({ openSync: (() => { opens++; throw new Error("must not open"); }) as typeof fs.openSync });
  expect(() => getPortfolioManagement(isolated)).toThrow(/64\s*KiB/);
  expect(opens).toBe(0);
});

test("server read errors fail closed and close the opened descriptor", async () => {
  const isolated = fixtureRoot();
  fs.writeFileSync(path.join(isolated, "portfolio-settings.json"), JSON.stringify({ schemaVersion: 1, order: [], hidden: [], featured }));
  const closed: number[] = [];
  const { getPortfolioManagement } = await managementWithFs({
    readSync: (() => { throw Object.assign(new Error("read denied"), { code: "EIO" }); }) as typeof fs.readSync,
    closeSync: (fd: number) => { closed.push(fd); fs.closeSync(fd); },
  });
  expect(() => getPortfolioManagement(isolated)).toThrow(/[가-힣]/);
  expect(closed).toHaveLength(1);
  expect(() => fs.fstatSync(closed[0])).toThrow();
});

test("server detects same-inode changes during bounded reads", async () => {
  const isolated = fixtureRoot();
  const filename = path.join(isolated, "portfolio-settings.json");
  fs.writeFileSync(filename, JSON.stringify({ schemaVersion: 1, order: [], hidden: [], featured }));
  let changed = false;
  const { getPortfolioManagement } = await managementWithFs({
    readSync: ((fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
      const count = fs.readSync(fd, buffer, offset, length, position);
      if (!changed) { changed = true; fs.appendFileSync(filename, " "); }
      return count;
    }) as typeof fs.readSync,
  });
  expect(() => getPortfolioManagement(isolated)).toThrow(/변경/);
});

test("server open permission errors are not treated as missing files", async () => {
  const isolated = fixtureRoot();
  fs.writeFileSync(path.join(isolated, "portfolio-settings.json"), JSON.stringify({ schemaVersion: 1, order: [], hidden: [], featured }));
  const { getPortfolioManagement } = await managementWithFs({ openSync: (() => { throw Object.assign(new Error("denied"), { code: "EACCES" }); }) as typeof fs.openSync });
  expect(() => getPortfolioManagement(isolated)).toThrow(/[가-힣]/);
});

test("shared settings API normalizes, round-trips, and clones the happy path", async () => {
  const api: SettingsApi = await settingsApi();
  expect(api.PORTFOLIO_SETTINGS_FILENAME).toBe("portfolio-settings.json");
  expect(api.MAX_PORTFOLIO_SETTINGS_BYTES).toBe(65536);
  expect(api.DEFAULT_FEATURED_IDS).toEqual(featured);
  const value = draft();
  const original = structuredClone(value);
  const baseline = [...ids];
  const normalized = api.normalizePortfolioSettings(value, baseline);
  expect(normalized).toEqual({ ...value, order: ["jd002", ...ids.filter(id => id !== "jd002")] });
  expect(api.createDefaultPortfolioSettings(ids)).toEqual({ schemaVersion: 1, order: ids, hidden: [], featured });
  api.validatePortfolioSettings(value, ids);
  expect(api.parsePortfolioSettings(JSON.stringify(value), ids)).toEqual(normalized);
  const serialized = api.serializePortfolioSettings(value, ids);
  expect(serialized).toBe(JSON.stringify(normalized, null, 2) + "\n");
  expect(api.parsePortfolioSettings(serialized, ids)).toEqual(normalized);
  expect(value).toEqual(original);
  expect(baseline).toEqual(ids);
  normalized.order.reverse(); normalized.hidden.push("jd002"); normalized.featured.reverse();
  expect(value).toEqual(original);
  const defaults = api.createDefaultPortfolioSettings(ids);
  defaults.featured.reverse(); defaults.order.reverse(); defaults.hidden.push("jd002");
  expect(api.DEFAULT_FEATURED_IDS).toEqual(featured);
  expect(api.createDefaultPortfolioSettings(ids)).toEqual({ schemaVersion: 1, order: ids, hidden: [], featured });
});
