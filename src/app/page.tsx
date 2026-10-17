import Hero from "@/components/home/Hero";
import PromoGrid from "@/components/home/PromoGrid";
import { getProjectModelPath } from "@/lib/portfolioModels";
import { getPortfolioCatalog } from "@/lib/portfolioCatalog";

const featuredIds = ["jd025_c", "jd008_b", "jd005_b", "jd013"];

export default function Home() {
  // Resolve assets at build time: never ship filesystem access to the browser.
  const catalog = getPortfolioCatalog();
  const projects = featuredIds.flatMap((id) => {
    const project = catalog.find((item) => item.id === id);
    if (!project) return [];
    return getProjectModelPath(project.folder) ? [project] : [];
  });

  return (
    <div className="min-h-screen bg-[#F5F5F7]">
      <Hero />
      <div className="bg-[#FFFFFF] dark:bg-[#000000] transition-colors duration-300">
        <PromoGrid projects={projects} />
      </div>
    </div>
  );
}
