import PortfolioGrid from "@/components/portfolio/PortfolioGrid";
import { getPortfolioManagement } from "@/lib/portfolioManagement";

export const metadata = {
  title: "Portfolio - JiD",
  description: "JiD의 혁신적인 프로젝트 포트폴리오입니다.",
};

export default function PortfolioPage() {
  const { projects } = getPortfolioManagement();
  return (
    <div className="flex flex-col min-h-screen bg-[#F5F5F7] dark:bg-[#111111]">
      <PortfolioGrid projects={projects} />
    </div>
  );
}
