import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("Pages size check enforces the published byte limit without altering files", async () => {
  const { inspectPagesSize } = await import(
    "../../scripts/check-pages-size.mjs"
  );
  const root = await fs.mkdtemp(
    path.join(
      process.env.TMPDIR || process.env.RUNNER_TEMP || process.cwd(),
      "jid-size-",
    ),
  );
  try {
    await fs.mkdir(path.join(root, "nested"));
    await fs.writeFile(path.join(root, "one"), Buffer.alloc(7));
    await fs.writeFile(path.join(root, "nested/two"), Buffer.alloc(9));
    assert.deepEqual(await inspectPagesSize(root, 16), {
      bytes: 16,
      files: 2,
      limit: 16,
    });
    await assert.rejects(inspectPagesSize(root, 15), /limit/i);
    assert.equal((await fs.readFile(path.join(root, "one"))).length, 7);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Pages size check rejects symlinked files rather than traversing outside the export", async () => {
  const { inspectPagesSize } = await import(
    "../../scripts/check-pages-size.mjs"
  );
  const root = await fs.mkdtemp(
    path.join(
      process.env.TMPDIR || process.env.RUNNER_TEMP || process.cwd(),
      "jid-size-",
    ),
  );
  try {
    await fs.symlink(os.homedir(), path.join(root, "escape"));
    await assert.rejects(inspectPagesSize(root), /symlink/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
