import legacyProjects from "../../public/images/portfolio/portfolio_data.json";
import { getAdminProjects } from "./adminProjects";
import type { AdminCatalogProject } from "./admin/types";

export type PortfolioCatalogProject = AdminCatalogProject & {
  description?: string;
};

// Server/build-only entry point: retain original metadata and registry order.
// The pages apply their existing display ordering before passing metadata down.
export function getPortfolioCatalog(
  root = process.cwd(),
): PortfolioCatalogProject[] {
  const legacyIds = new Set(legacyProjects.map((project) => project.id));
  const additions = getAdminProjects(root).map(
    ({ id, folder, title, category, image }) => {
      if (legacyIds.has(id))
        throw new Error(`Admin registry collides with legacy project: ${id}`);
      return { id, folder, title, category, image };
    },
  );
  return [...legacyProjects, ...additions];
}
