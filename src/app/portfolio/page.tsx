import PortfolioGrid from "@/components/portfolio/PortfolioGrid";
import { getPortfolioCatalog } from "@/lib/portfolioCatalog";
import { sortPortfolioProjects } from "@/lib/portfolioOrdering";

export const metadata = {
  title: "Portfolio - JiD",
  description: "JiD의 혁신적인 프로젝트 포트폴리오입니다.",
};

export default function PortfolioPage() {
  return (
    <div className="flex flex-col min-h-screen bg-[#F5F5F7] dark:bg-[#111111]">
      <PortfolioGrid projects={sortPortfolioProjects(getPortfolioCatalog())} />
    </div>
  );
}
