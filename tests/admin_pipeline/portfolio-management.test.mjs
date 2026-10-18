import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const featured = ["jd025_c", "jd008_b", "jd005_b", "jd013"];

// Exercise the real npm publication gate without touching checkout settings,
// generated output, original media, or the workbook. Dependencies are read-only.
async function publicationFixture(t) {
  const directory = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), "portfolio-publication-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const name of ["package.json", "src/lib", "tests/portfolio_settings", "scripts/import-admin-submissions.py", "public/images/portfolio/portfolio_data.json"]) {
    const target = path.join(directory, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(new URL(name, root), target, { recursive: true });
  }
  await fs.symlink(fileURLToPath(new URL("node_modules", root)), path.join(directory, "node_modules"), "dir");
  const projects = JSON.parse(await fs.readFile(path.join(directory, "public/images/portfolio/portfolio_data.json"), "utf8"));
  return { directory, ids: projects.map(project => project.id) };
}

function publicationGate(directory) {
  return spawnSync("npm", ["run", "test:portfolio-settings"], {
    cwd: directory, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, PORTFOLIO_SETTINGS_QA_ROOT: path.join(directory, "qa") },
  });
}

function gateEvidence(result) {
  return `${result.error || ""}\n${result.stdout}\n${result.stderr}`;
}

async function assertExecutedSettingsGate(directory) {
  const report = JSON.parse(await fs.readFile(path.join(directory, "qa/backend-latest.json"), "utf8"));
  assert.ok(report.stats.expected > 100, "the complete Node settings suite executed");
  assert.equal(report.stats.unexpected, 0);
  assert.equal(report.stats.skipped, 0);
  assert.equal(report.stats.flaky, 0);
  assert.deepEqual(report.errors, []);
}

test("publication gate accepts a nondefault UI-format full-order export", { timeout: 90_000 }, async t => {
  const { directory, ids } = await publicationFixture(t);
  // Captured from the actual browser export, not a replacement implementation.
  const source = await fs.readFile(new URL("tests/portfolio_settings/fixtures/nondefault-ui-export.json", root), "utf8");
  const value = JSON.parse(source);
  assert.deepEqual([...value.order].sort(), [...ids].sort());
  assert.deepEqual(value.hidden, ["jd038"]);
  assert.equal(value.featured[0], "jd002");
  await fs.writeFile(path.join(directory, "portfolio-settings.json"), source);
  const result = publicationGate(directory);
  assert.equal(result.status, 0, gateEvidence(result));
  await assertExecutedSettingsGate(directory);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, "portfolio-settings.json"), "utf8")), value);
});

test("publication gate accepts an unchanged default selection with normalized full order", { timeout: 90_000 }, async t => {
  const { directory, ids } = await publicationFixture(t);
  const value = { schemaVersion: 1, order: ["jd038", ...ids.filter(id => id !== "jd038")], hidden: [], featured };
  await fs.writeFile(path.join(directory, "portfolio-settings.json"), JSON.stringify(value, null, 2) + "\n");
  const result = publicationGate(directory);
  assert.equal(result.status, 0, gateEvidence(result));
  await assertExecutedSettingsGate(directory);
});

test("fresh CMS publication imports a real ZIP before validating its featured ID", { timeout: 90_000 }, async t => {
  const { directory, ids } = await publicationFixture(t);
  const submissions = path.join(directory, "admin-submissions");
  await fs.mkdir(submissions);
  // Existing importer helper builds a genuine CRC-checked 1px PNG and manifest.
  const fixture = spawnSync("python3", ["-c", [
    "import sys, runpy, json, zipfile",
    "sys.dont_write_bytecode = True",
    "manifest, payloads = runpy.run_path(sys.argv[1])['package']('jd900')",
    "with zipfile.ZipFile(sys.argv[2], 'w', compression=zipfile.ZIP_DEFLATED) as archive:",
    "    archive.writestr('project.json', json.dumps(manifest))",
    "    for name, data in payloads.items(): archive.writestr(name, data)",
  ].join("\n"), fileURLToPath(new URL("tests/admin_importer/test_importer.py", root)), path.join(submissions, "jd900.zip")], { encoding: "utf8", timeout: 10_000 });
  assert.equal(fixture.status, 0, gateEvidence(fixture));
  const value = { schemaVersion: 1, order: ["jd900", ...ids.reverse()], hidden: ["jd038"], featured: ["jd900", "jd002", ...featured.slice(1, 3)] };
  await fs.writeFile(path.join(directory, "portfolio-settings.json"), JSON.stringify(value, null, 2) + "\n");
  const registry = path.join(directory, ".generated/admin-projects.json");
  await assert.rejects(fs.access(registry), { code: "ENOENT" });

  // Prove the fresh-checkout failure independently, deliberately bypassing npm's hook.
  const before = spawnSync(process.execPath, [fileURLToPath(new URL("node_modules/@playwright/test/cli.js", root)), "test", "--config", "tests/portfolio_settings/settings.config.ts", "--grep", "checked-out publication"], {
    cwd: directory, encoding: "utf8", timeout: 30_000,
    env: { ...process.env, PORTFOLIO_SETTINGS_QA_ROOT: path.join(directory, "before-import-qa") },
  });
  assert.equal(before.status, 1, gateEvidence(before));
  assert.match(before.stdout, /현재 목록에 없는 ID/);
  const beforeReport = JSON.parse(await fs.readFile(path.join(directory, "before-import-qa/backend-latest.json"), "utf8"));
  assert.equal(beforeReport.stats.unexpected, 1);
  assert.deepEqual(beforeReport.errors, []);
  await assert.rejects(fs.access(registry), { code: "ENOENT" });

  const result = publicationGate(directory);
  assert.equal(result.status, 0, gateEvidence(result));
  assert.match(result.stdout, /pretest:portfolio-settings[\s\S]*import-admin-submissions\.py --root \./);
  await assertExecutedSettingsGate(directory);
  const imported = JSON.parse(await fs.readFile(registry, "utf8"));
  assert.deepEqual(imported.projects.map(project => project.id), ["jd900"]);
  assert.deepEqual(imported.projects[0].models, []);
  const image = await fs.readFile(path.join(directory, "public", imported.projects[0].image));
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, "portfolio-settings.json"), "utf8")), value);
});

test("publication gate rejects an invalid committed ZIP before settings tests", { timeout: 90_000 }, async t => {
  const { directory } = await publicationFixture(t);
  await fs.mkdir(path.join(directory, "admin-submissions"));
  await fs.writeFile(path.join(directory, "admin-submissions/jd900.zip"), "not a ZIP");
  const result = publicationGate(directory);
  assert.notEqual(result.status, 0, gateEvidence(result));
  assert.match(result.stderr, /error:/i);
  await assert.rejects(fs.access(path.join(directory, "qa/backend-latest.json")), { code: "ENOENT" });
  await assert.rejects(fs.access(path.join(directory, ".generated/admin-projects.json")), { code: "ENOENT" });
});

test("publication gate rejects invalid checkout settings after real import", { timeout: 90_000 }, async t => {
  const { directory } = await publicationFixture(t);
  await fs.writeFile(path.join(directory, "portfolio-settings.json"), JSON.stringify({ schemaVersion: 1, order: ["jd999"], hidden: [], featured }));
  const result = publicationGate(directory);
  assert.equal(result.status, 1, gateEvidence(result));
  assert.match(result.stdout, /현재 목록에 없는 ID/);
  const registry = JSON.parse(await fs.readFile(path.join(directory, ".generated/admin-projects.json"), "utf8"));
  assert.deepEqual(registry.projects, []);
  const report = JSON.parse(await fs.readFile(path.join(directory, "qa/backend-latest.json"), "utf8"));
  assert.equal(report.stats.unexpected, 1);
  assert.equal(report.stats.skipped, 0);
  assert.deepEqual(report.errors, []);
  const specs = (suites = []) => suites.flatMap(suite => [...(suite.specs || []), ...specs(suite.suites)]);
  assert.deepEqual(specs(report.suites).filter(spec => !spec.ok).map(spec => spec.title), ["checked-out publication settings resolve against the complete current catalog"]);
});

const root = new URL("../../", import.meta.url);

test("opaque editor forwards complete management metadata and published settings without changing crawler exclusion", async () => {
  const page = await fs.readFile(new URL("src/app/vhxmvhffldhdjqfhemrkdlem/page.tsx", root), "utf8");
  assert.match(page, /getPortfolioManagement/);
  assert.match(page, /projects=\{\w+\.allProjects\}/);
  assert.match(page, /initialSettings=\{\w+\.settings\}/);
  assert.match(page, /index: false/);
  assert.match(page, /follow: false/);
});

test("catalog manager remains mounted across tabs and shares the existing unsaved-change boundary", async () => {
  const source = await fs.readFile(new URL("src/components/admin/AdminWorkspace.tsx", root), "utf8");
  assert.match(source, /import PortfolioManager from "\.\/PortfolioManager"/);
  assert.match(source, /hidden=\{tab !== "catalog"\}/);
  assert.match(source, /onDirtyChange=\{setCatalogDirty\}/);
  assert.match(source, /dirtyRef\.current = dirty \|\| catalogDirty/);
});

test("mounted catalog preservation disclaimer is a named section, not site footer chrome", async () => {
  const source = await fs.readFile(new URL("src/components/admin/PortfolioManager.tsx", root), "utf8");
  assert.doesNotMatch(source, /<footer\b/);
  assert.match(source, /<section className=\{styles\.disclaimer\} aria-labelledby="portfolio-preservation-heading"><h2 id="portfolio-preservation-heading">작품은 보존하고, 공개 흐름만 바꿉니다\.<\/h2>/);
});

test("native GitHub same-commit deployment runs management validation before building", async () => {
  const pkg = JSON.parse(await fs.readFile(new URL("package.json", root), "utf8"));
  assert.match(pkg.scripts["test:portfolio-settings"] ?? "", /playwright test --config tests\/portfolio_settings\/settings\.config\.ts/);
  assert.equal(pkg.scripts["pretest:portfolio-settings"], "python3 scripts/import-admin-submissions.py --root .");
  const workflow = await fs.readFile(new URL(".github/workflows/deploy.yml", root), "utf8");
  const position = workflow.indexOf("npm run test:portfolio-settings");
  assert.ok(position >= 0 && position < workflow.indexOf("run: npm run build"));
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /contents: write|git push|git commit|pull_request_target/);
});
