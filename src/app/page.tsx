import Hero from "@/components/home/Hero";
import PromoGrid from "@/components/home/PromoGrid";
import { getPortfolioManagement } from "@/lib/portfolioManagement";

export default function Home() {
  // Resolve publication settings at build time, including image-only projects.
  const { featuredProjects } = getPortfolioManagement();

  return (
    <div className="min-h-screen bg-[#F5F5F7]">
      <Hero />
      <div className="bg-[#FFFFFF] dark:bg-[#000000] transition-colors duration-300">
        <PromoGrid projects={featuredProjects} />
      </div>
    </div>
  );
}
