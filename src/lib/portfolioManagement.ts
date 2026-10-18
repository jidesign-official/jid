import fs from "node:fs";
import path from "node:path";
import { getPortfolioCatalog, type PortfolioCatalogProject } from "./portfolioCatalog";
import { sortPortfolioProjects } from "./portfolioOrdering";
import {
  createDefaultPortfolioSettings,
  parsePortfolioSettings,
  PORTFOLIO_SETTINGS_FILENAME,
  MAX_PORTFOLIO_SETTINGS_BYTES,
  type PortfolioSettings,
} from "./portfolioSettings";

const sameSnapshot = (a: fs.Stats, b: fs.Stats) =>
  a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
  a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

function readSettings(root: string, ids: readonly string[]): PortfolioSettings {
  const filename = path.join(root, PORTFOLIO_SETTINGS_FILENAME);
  let initial: fs.Stats;
  try {
    initial = fs.lstatSync(filename);
  } catch (error) {
    // Only an absent initial directory entry is a default. Later ENOENT is a race/error.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return createDefaultPortfolioSettings(ids);
    throw new Error("포트폴리오 설정 파일 상태를 읽을 수 없습니다. 경로와 읽기 권한을 확인하세요.", { cause: error });
  }
  if (!initial.isFile() || initial.isSymbolicLink()) {
    throw new Error("포트폴리오 설정은 심볼릭 링크가 아닌 일반 파일이어야 합니다.");
  }
  if (initial.size > MAX_PORTFOLIO_SETTINGS_BYTES) {
    throw new Error("포트폴리오 설정 파일은 UTF-8 기준 64 KiB 이하여야 합니다.");
  }

  let fd: number | undefined;
  let source: string;
  try {
    // NOFOLLOW rejects a link swapped in after lstat; NONBLOCK prevents a swapped FIFO hanging.
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || !sameSnapshot(initial, opened)) {
      throw new Error("설정 파일이 읽는 중 변경되었습니다. 일반 파일인지 확인하고 다시 시도하세요.");
    }
    // Never trust stat as an allocation/read bound: allow only one sentinel byte beyond 64 KiB.
    const buffer = Buffer.alloc(MAX_PORTFOLIO_SETTINGS_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > MAX_PORTFOLIO_SETTINGS_BYTES) {
      throw new Error("설정 파일은 UTF-8 기준 64 KiB 이하여야 합니다.");
    }
    const after = fs.fstatSync(fd);
    const current = fs.lstatSync(filename);
    if (!current.isFile() || !sameSnapshot(opened, after) || !sameSnapshot(after, current) || after.size !== length) {
      throw new Error("설정 파일이 읽는 중 변경되었습니다. 파일을 확인하고 다시 시도하세요.");
    }
    // Reject malformed UTF-8 instead of replacing bytes or silently stripping a BOM.
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    throw new Error(`포트폴리오 설정 파일을 읽을 수 없습니다. 파일과 읽기 권한을 확인하세요. ${detail}`, { cause: error });
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return parsePortfolioSettings(source, ids);
}

// Server/build-only: client components receive the resolved catalog and settings.
export function getPortfolioManagement(root = process.cwd()): {
  allProjects: PortfolioCatalogProject[];
  settings: PortfolioSettings;
  projects: PortfolioCatalogProject[];
  featuredProjects: PortfolioCatalogProject[];
} {
  const allProjects = sortPortfolioProjects(getPortfolioCatalog(root), root);
  const settings = readSettings(root, allProjects.map(project => project.id));
  const hidden = new Set(settings.hidden);
  const byId = new Map(allProjects.map(project => [project.id, project]));
  return {
    allProjects,
    settings,
    projects: settings.order.filter(id => !hidden.has(id)).map(id => byId.get(id)!),
    featuredProjects: settings.featured.map(id => byId.get(id)!),
  };
}
