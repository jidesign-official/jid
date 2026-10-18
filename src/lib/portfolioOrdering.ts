import fs from "node:fs";
import path from "node:path";
import { getProjectModelPaths } from "./portfolioModels";

// Server/build-only: the client receives the ordered metadata, never filesystem code.
export function sortPortfolioProjects<T extends { id: string; folder?: string }>(
  projects: readonly T[],
  root = process.cwd(),
): T[] {
  return projects
    .map((project, index) => {
      const models = getProjectModelPaths(project.folder || project.id, root);
      const bytes = models.reduce(
        (total, model) => total + fs.statSync(path.join(root, "public", model)).size,
        0,
      );
      return { project, index, count: models.length, bytes };
    })
    .sort((a, b) =>
      Number(b.project.id === "jd038") - Number(a.project.id === "jd038") ||
      b.count - a.count ||
      (a.count > 0 ? a.bytes - b.bytes : 0) ||
      a.index - b.index,
    )
    .map(({ project }) => project);
}
