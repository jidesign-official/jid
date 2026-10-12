"use client";

import Link from "next/link";
import { getAssetPath } from "@/lib/basePath";

export default function Footer() {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <footer className="w-full bg-[#F5F5F7] dark:bg-[#111111] border-t border-[#1D1D1F]/10 dark:border-[#F5F5F7]/10 transition-colors duration-300 text-[#1D1D1F]/70 dark:text-[#F5F5F7]/70 text-xs">
      <div className="max-w-[1024px] mx-auto px-4 py-8 md:py-12">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 pb-6 border-b border-[#1D1D1F]/10 dark:border-[#F5F5F7]/10">
          
          {/* Logo & Slogan */}
          <div className="flex flex-col gap-2">
            <Link href="/" className="flex items-center gap-2" aria-label="JiD 홈">
              <img
                src={getAssetPath("/logo.png")}
                alt="JiD"
                className="dark:hidden h-6 w-auto object-contain"
              />
              <img
                src={getAssetPath("/logo_dark.png")}
                alt="JiD"
                className="hidden dark:block h-6 w-auto object-contain"
              />
            </Link>
            <p className="text-xs text-[#1D1D1F]/60 dark:text-[#F5F5F7]/60">
              From Imagination to Intuition
            </p>
          </div>

          {/* Quick Navigation */}
          <div className="flex items-center gap-6 text-[13px] font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
            <Link href="/about" className="hover:text-[#0066CC] transition-colors">
              About Us
            </Link>
            <Link href="/portfolio" className="hover:text-[#0066CC] transition-colors">
              Portfolio
            </Link>
            <Link href="/contact" className="hover:text-[#0066CC] transition-colors">
              Contact
            </Link>
          </div>

          {/* Back to top button */}
          <button
            onClick={scrollToTop}
            className="flex items-center gap-1.5 text-xs text-[#1D1D1F]/80 dark:text-[#F5F5F7]/80 hover:text-[#0066CC] dark:hover:text-[#0066CC] transition-colors"
            aria-label="페이지 맨 위로 이동"
          >
            <span>Back to top</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-3.5 h-3.5"
            >
              <path d="m18 15-6-6-6 6" />
            </svg>
          </button>
        </div>

        {/* Copyright */}
        <p className="pt-6 text-center text-[11px] text-[#1D1D1F]/50 dark:text-[#F5F5F7]/50">
          Copyright © {new Date().getFullYear()} JiD. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
