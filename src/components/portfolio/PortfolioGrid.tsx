"use client";

import { useState, useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import Link from "next/link";
import { getAssetPath } from "@/lib/basePath";

export interface PortfolioItem {
  id: string;
  folder: string;
  title: string;
  category: string;
  image: string;
  description?: string;
}

const tabs = ["모든 프로젝트", "Product", "UX/UI"];

export default function PortfolioGrid({ projects }: { projects: readonly PortfolioItem[] }) {
  const getTabCount = (tabName: string) => {
    if (tabName === "모든 프로젝트") return projects.length;
    return projects.filter((product) => product.category === tabName).length;
  };
  const [activeTab, setActiveTab] = useState("모든 프로젝트");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  const gridRef = useRef<HTMLDivElement>(null);

  // 탭 필터링
  const filteredProducts = projects.filter((product) =>
    activeTab === "모든 프로젝트" ? true : product.category === activeTab
  );

  // 페이징 계산
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const currentProducts = filteredProducts.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // 탭이나 페이지 변경 시 카드 애니메이션
  useGSAP(() => {
    if (!gridRef.current) return;
    
    gsap.fromTo(
      gridRef.current.children,
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.5, stagger: 0.03, ease: "power2.out" }
    );
  }, [activeTab, currentPage]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setCurrentPage(1); // 탭 변경 시 1페이지로 리셋
  };

  return (
    <section className="w-full bg-[#F5F5F7] dark:bg-[#111111] py-16 md:py-24 px-4 md:px-8 min-h-screen">
      <div className="max-w-[1440px] mx-auto">
        
        {/* 상단 탭 메뉴 */}
        <div className="flex justify-center mb-12">
          <div className="bg-[#E5E5EA] dark:bg-[#2C2C2E] p-1 rounded-full flex gap-1">
            {tabs.map((tab) => {
              const count = getTabCount(tab);
              return (
                <button
                  key={tab}
                  onClick={() => handleTabChange(tab)}
                  className={`px-5 py-2 rounded-full text-[14px] font-medium transition-colors duration-300 ${
                    activeTab === tab
                      ? "bg-[#1D1D1F] text-white dark:bg-white dark:text-black"
                      : "text-[#1D1D1F] hover:bg-gray-300 dark:text-[#F5F5F7] dark:hover:bg-gray-600"
                  }`}
                >
                  {tab} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* 4열 그리드: 썸네일 사이 간격을 30px로 통일 */}
        <div
          ref={gridRef}
          data-portfolio-grid
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[30px]"
        >
          {currentProducts.map((product) => (
            <Link
              key={product.id}
              href={`/portfolio/${product.id}`}
              className="group relative block w-full cursor-pointer rounded-[5px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0066CC]"
            >
              {/* 이미지 크기는 유지하고 내부 이미지만 확대·블러 처리 */}
              <div className="relative aspect-square w-full overflow-hidden rounded-[5px] bg-[#ffffff]">
                <img
                  src={getAssetPath(product.image)}
                  alt={product.title}
                  className="h-full w-full rounded-[5px] bg-[#ffffff] object-contain transition-[scale,filter] duration-200 ease-out motion-reduce:transition-none group-hover:scale-105 group-hover:blur-[3px]"
                />

                {/* 마우스 오버/키보드 포커스 시에만 제목 표시 */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#666666]/60 px-6 text-center opacity-0 transition-opacity duration-200 ease-out motion-reduce:transition-none group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  <h3 className="font-product text-[21px] !font-black leading-tight tracking-tight text-white">
                    {product.title}
                  </h3>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {filteredProducts.length === 0 && (
          <p role="status" className="py-20 text-center text-[#6E6E73] dark:text-[#A1A1A6]">
            프로젝트가 없습니다.
          </p>
        )}

        {/* 페이징 컨트롤 */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 mt-20">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 rounded-lg text-sm font-medium text-[#1D1D1F] dark:text-white disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
            >
              이전
            </button>
            <div className="flex gap-1">
              {Array.from({ length: totalPages }).map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentPage(idx + 1)}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                    currentPage === idx + 1
                      ? "bg-[#1D1D1F] text-white dark:bg-white dark:text-black"
                      : "text-[#1D1D1F] hover:bg-gray-200 dark:text-white dark:hover:bg-gray-800"
                  }`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-4 py-2 rounded-lg text-sm font-medium text-[#1D1D1F] dark:text-white disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
            >
              다음
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
