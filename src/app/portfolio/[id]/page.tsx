import Link from "next/link";
import { notFound } from "next/navigation";
import portfolioData from "../../../../public/images/portfolio/portfolio_data.json";
import DetailGalleryView from "@/components/portfolio/DetailGalleryView";
import Model3DViewer from "@/components/portfolio/Model3DViewer";
import { getAssetPath } from "@/lib/basePath";
import { getProjectModelPaths } from "@/lib/portfolioModels";
import { getProjectDetailImages } from "@/lib/portfolioImages";
import { sortPortfolioProjects } from "@/lib/portfolioOrdering";
import { pickPortfolioTagline } from "@/lib/portfolioTaglines";

interface PortfolioItem {
  id: string;
  folder: string;
  title: string;
  category: string;
  image: string;
  description?: string;
}

export async function generateStaticParams() {
  return (portfolioData as PortfolioItem[]).map((item) => ({
    id: item.id,
  }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const project = (portfolioData as PortfolioItem[]).find((p) => p.id === resolvedParams.id);
  if (!project) return { title: "Project Not Found - JiD" };

  return {
    title: `${project.title} - JiD`,
    description: `${project.title} 제품 디자인 포트폴리오 상세 페이지입니다.`,
  };
}

export default async function PortfolioDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;
  const projects = sortPortfolioProjects(portfolioData as PortfolioItem[]);
  const currentIndex = projects.findIndex((p) => p.id === resolvedParams.id);

  if (currentIndex === -1) {
    notFound();
  }

  const project = projects[currentIndex];
  const prevProject = currentIndex > 0 ? projects[currentIndex - 1] : null;
  const nextProject = currentIndex < projects.length - 1 ? projects[currentIndex + 1] : null;

  const folderName = project.folder || project.id;
  const allDetailImages = getProjectDetailImages(folderName);
  const sequenceNames = new Set(Array.from({ length: 11 }, (_, index) => `jd038_${index + 2}.jpg`));
  const sequenceFrames = folderName === "jd038" ? allDetailImages.filter((image) => sequenceNames.has(image.filename)) : [];
  const detailImages = folderName === "jd038" ? allDetailImages.filter((image) => !sequenceNames.has(image.filename)) : allDetailImages;
  const modelPaths = getProjectModelPaths(folderName);

  return (
    <div className="flex flex-col min-h-screen bg-[#F5F5F7] dark:bg-[#111111] transition-colors duration-300 py-12 md:py-20 px-4 md:px-8">
      <div className="max-w-[1024px] mx-auto w-full">
        
        {/* Top Back Navigation */}
        <div className="mb-8 md:mb-12">
          <Link
            href="/portfolio"
            className="inline-flex items-center gap-2 text-xs md:text-sm font-medium text-[#1D1D1F]/70 dark:text-[#F5F5F7]/70 hover:text-[#0066CC] dark:hover:text-[#0066CC] transition-colors"
          >
            <span>←</span>
            <span>포트폴리오 목록으로 돌아가기</span>
          </Link>
        </div>

        {/* Title Header */}
        <div className="text-center mb-12 md:mb-16">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#0066CC]">
            {project.category || "Product Design"}
          </span>
          <h1 className="text-3xl md:text-5xl font-[300] tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7] mt-2 leading-tight font-product">
            {project.title}
          </h1>
          <p className="mt-4 text-sm md:text-base text-[#1D1D1F]/60 dark:text-[#F5F5F7]/60 max-w-xl mx-auto">
            {pickPortfolioTagline()}
          </p>
        </div>

        {/* Main Product Thumbnail Display */}
        <div className="w-full max-w-[1024px] mx-auto aspect-square rounded-[5px] overflow-hidden flex items-center justify-center bg-[#ffffff]">
          <img
            src={getAssetPath(project.image)}
            alt={project.title}
            className="w-full h-full object-contain bg-[#ffffff] rounded-[5px]"
          />
        </div>

        {/* Detail Images Showcase */}
        <DetailGalleryView images={detailImages} sequenceFrames={sequenceFrames} projectTitle={project.title} />

        {/* 3D Interactive Model Showcase (Option B) */}
        {modelPaths.map((modelUrl, index) => (
          <Model3DViewer
            key={modelUrl}
            modelUrl={modelUrl}
            projectTitle={modelPaths.length > 1 ? `${project.title} — 모델 ${index + 1}` : project.title}
          />
        ))}

        {/* CTA Banner */}
        <div className="mt-16 md:mt-24 p-8 md:p-12 rounded-[5px] bg-white dark:bg-[#1C1C1E] border border-[#1D1D1F]/5 dark:border-white/10 text-center flex flex-col items-center justify-center gap-4 shadow-sm">
          <h3 className="text-xl md:text-2xl font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
            이 프로젝트에 대해 궁금하신가요?
          </h3>
          <p className="text-sm text-[#1D1D1F]/60 dark:text-[#F5F5F7]/60 max-w-md">
            유사한 디자인 프로젝트 구상이나 제품 개발 협업에 대해 편리하게 문의해 보세요.
          </p>
          <Link
            href="/contact"
            className="mt-2 px-8 py-3.5 rounded-full bg-[#0066CC] hover:bg-[#0055B3] text-white font-medium text-sm transition-all shadow-sm hover:shadow"
          >
            프로젝트 문의하기 ➔
          </Link>
        </div>

        {/* Bottom Prev / Next Navigation */}
        <div className="mt-12 pt-8 border-t border-[#1D1D1F]/10 dark:border-[#F5F5F7]/10 grid grid-cols-2 gap-6 items-center text-sm font-medium">
          {prevProject ? (
            <Link
              href={`/portfolio/${prevProject.id}`}
              className="min-w-0 flex flex-col items-start group hover:text-[#0066CC] transition-colors"
            >
              <span className="text-xs text-[#1D1D1F]/40 dark:text-[#F5F5F7]/40 mb-1">← 이전 프로젝트</span>
              <span className="text-[#1D1D1F] dark:text-[#F5F5F7] group-hover:text-[#0066CC] transition-colors truncate max-w-full md:max-w-[300px]">
                {prevProject.title}
              </span>
            </Link>
          ) : (
            <div />
          )}

          {nextProject && (
            <Link
              href={`/portfolio/${nextProject.id}`}
              className="min-w-0 flex flex-col items-end text-right group hover:text-[#0066CC] transition-colors"
            >
              <span className="text-xs text-[#1D1D1F]/40 dark:text-[#F5F5F7]/40 mb-1">다음 프로젝트 →</span>
              <span className="text-[#1D1D1F] dark:text-[#F5F5F7] group-hover:text-[#0066CC] transition-colors truncate max-w-full md:max-w-[300px]">
                {nextProject.title}
              </span>
            </Link>
          )}
        </div>

      </div>
    </div>
  );
}
