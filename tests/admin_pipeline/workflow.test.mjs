import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const root = new URL("../../", import.meta.url);

test("normal dev/build entry points validate packages and final export before publishing", async () => {
  const pkg = JSON.parse(
    await fs.readFile(new URL("package.json", root), "utf8"),
  );
  assert.equal(
    pkg.scripts.prebuild,
    "python3 scripts/import-admin-submissions.py --root .",
  );
  assert.equal(pkg.scripts.predev, pkg.scripts.prebuild);
  assert.equal(pkg.scripts.postbuild, "node scripts/check-pages-size.mjs out");
  assert.match(pkg.scripts["test:admin-importer"], /unittest discover/);
  assert.match(pkg.scripts["test:admin-pipeline"], /node --test/);
});

test("GitHub deployment retains native authorization and validates the same source commit without write tokens", async () => {
  const workflow = await fs.readFile(
    new URL(".github/workflows/deploy.yml", root),
    "utf8",
  );
  assert.match(workflow, /branches: \["main"\]/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(
    workflow,
    /contents: write|pull_request_target|git push|git commit/,
  );
  assert.ok(
    workflow.indexOf("npm run test:admin-importer") <
      workflow.indexOf("run: npm run build"),
  );
  assert.ok(
    workflow.indexOf("npm run test:admin-pipeline") <
      workflow.indexOf("run: npm run build"),
  );
  assert.ok(
    workflow.indexOf("run: npm run build") <
      workflow.indexOf("uses: actions/upload-pages-artifact"),
  );
  assert.match(
    workflow,
    /NEXT_PUBLIC_BASE_PATH: \$\{\{ steps\.pages\.outputs\.base_path \}\}/,
  );
  assert.match(workflow, /needs: build/);
});
