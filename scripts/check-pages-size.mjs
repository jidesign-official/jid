import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function inspectPagesSize(directory, limit = 1_000_000_000) {
  let bytes = 0;
  let files = 0;
  async function walk(folder) {
    for (const name of await fs.readdir(folder)) {
      const item = path.join(folder, name);
      const stat = await fs.lstat(item);
      if (stat.isSymbolicLink())
        throw new Error(`Symlink is not allowed in Pages export: ${item}`);
      if (stat.isDirectory()) await walk(item);
      else if (stat.isFile()) {
        bytes += stat.size;
        files++;
      } else throw new Error(`Unsupported export file: ${item}`);
    }
  }
  await walk(path.resolve(directory));
  if (bytes > limit)
    throw new Error(
      `Pages size limit exceeded: ${bytes} bytes > ${limit} bytes. Remove/optimize media before publishing.`,
    );
  return { bytes, files, limit };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  inspectPagesSize(process.argv[2] || "out").then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
