import fs from "node:fs";
import path from "node:path";
import {
  ABOUT_CONTENT_FILENAME,
  MAX_ABOUT_CONTENT_BYTES,
  createDefaultAboutContent,
  parseAboutContent,
  type AboutContent,
} from "./aboutContent";

const sameSnapshot = (a: fs.Stats, b: fs.Stats) =>
  a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
  a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

// Server/build-only. Only initial absence is a default; present content must fail closed.
export function getAboutContent(root = process.cwd()): AboutContent {
  const filename = path.join(root, ABOUT_CONTENT_FILENAME);
  let initial: fs.Stats;
  try {
    initial = fs.lstatSync(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return createDefaultAboutContent();
    throw new Error("About 콘텐츠 파일 상태를 읽을 수 없습니다. 경로와 권한을 확인하세요.", { cause: error });
  }
  if (!initial.isFile() || initial.isSymbolicLink()) throw new Error("About 콘텐츠는 심볼릭 링크가 아닌 일반 파일이어야 합니다.");
  if (initial.size > MAX_ABOUT_CONTENT_BYTES) throw new Error("About 콘텐츠 파일은 UTF-8 기준 64 KiB 이하여야 합니다.");
  let fd: number | undefined;
  let source: string;
  try {
    // NOFOLLOW blocks swapped links; NONBLOCK prevents a swapped FIFO from hanging.
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || !sameSnapshot(initial, opened)) {
      throw new Error("About 콘텐츠 파일이 읽는 중 변경되었습니다. 일반 파일인지 확인하고 다시 시도하세요.");
    }
    const buffer = Buffer.alloc(MAX_ABOUT_CONTENT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > MAX_ABOUT_CONTENT_BYTES) throw new Error("About 콘텐츠 파일은 UTF-8 기준 64 KiB 이하여야 합니다.");
    const after = fs.fstatSync(fd);
    const current = fs.lstatSync(filename);
    if (!current.isFile() || current.isSymbolicLink() || !sameSnapshot(opened, after) || !sameSnapshot(after, current) || after.size !== length) {
      throw new Error("About 콘텐츠 파일이 읽는 중 변경되었습니다. 파일을 확인하고 다시 시도하세요.");
    }
    // Fatal decoding preserves a BOM so the JSON parser rejects it instead of silently changing input.
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    throw new Error(`About 콘텐츠 파일을 읽을 수 없습니다. 파일과 권한을 확인하세요. ${detail}`, { cause: error });
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return parseAboutContent(source);
}
