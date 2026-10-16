"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

import ThemeToggle from "@/components/common/ThemeToggle";
import { getAssetPath } from "@/lib/basePath";

const navItems = [
  { name: "About Us", href: "/about" },
  { name: "Portfolio", href: "/portfolio" },
  { name: "Contact", href: "/contact" },
];

export default function GNB() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const menuItemsRef = useRef<HTMLUListElement>(null);

  useGSAP(() => {
    if (!mobileMenuRef.current || !menuItemsRef.current) return;

    if (isMobileMenuOpen) {
      gsap.to(mobileMenuRef.current, {
        height: "100vh",
        opacity: 1,
        duration: 0.5,
        ease: "power3.inOut",
        display: "block",
      });
      gsap.fromTo(
        menuItemsRef.current.children,
        { y: 20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.4, stagger: 0.04, ease: "power2.out", delay: 0.2 }
      );
    } else {
      gsap.to(mobileMenuRef.current, {
        height: 0,
        opacity: 0,
        duration: 0.4,
        ease: "power3.inOut",
        onComplete: () => {
          if (mobileMenuRef.current) {
            gsap.set(mobileMenuRef.current, { display: "none" });
          }
        },
      });
    }
  }, [isMobileMenuOpen]);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[#F5F5F7]/80 dark:bg-[#000000]/80 backdrop-blur-md transition-colors duration-300">
      <nav className="mx-auto max-w-[1024px] px-4" aria-label="Global Navigation">
        <div className="flex h-[44px] items-center justify-between text-xs font-normal tracking-[-0.01em] text-[#1D1D1F] dark:text-[#F5F5F7]">
          
          <button
            className="md:hidden p-2 flex flex-col justify-center items-center gap-[4px] z-50 relative"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label={isMobileMenuOpen ? "메뉴 닫기" : "메뉴 열기"}
            aria-expanded={isMobileMenuOpen}
          >
            <div className={`w-[14px] h-[1px] bg-current transition-transform duration-300 ease-apple ${isMobileMenuOpen ? "rotate-45 translate-y-[2.5px]" : ""}`} />
            <div className={`w-[14px] h-[1px] bg-current transition-transform duration-300 ease-apple ${isMobileMenuOpen ? "-rotate-45 -translate-y-[2.5px]" : ""}`} />
          </button>

          <Link href="/" className="transition-opacity hover:opacity-70 z-50 relative flex items-center" aria-label="홈">
            {/* Light mode logo */}
            <img 
              src={getAssetPath("/logo.png")} 
              alt="JiD"
              className="dark:hidden h-7 md:h-8 w-auto object-contain"
            />
            {/* Dark mode logo */}
            <img 
              src={getAssetPath("/logo_dark.png")} 
              alt="JiD"
              className="hidden dark:block h-7 md:h-8 w-auto object-contain"
            />
          </Link>

          <ul className="hidden md:flex flex-1 justify-start gap-10 pl-12">
            {navItems.map((item) => (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className="py-3 transition-colors hover:text-black dark:hover:text-white opacity-80 hover:opacity-100 text-[13px]"
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-1.5 md:gap-2 z-50 relative">
            {/* Instagram Link Button */}
            <a
              href="https://www.instagram.com/jidesign.official"
              target="_blank"
              rel="noreferrer"
              aria-label="Instagram"
              className="p-2 text-[#1D1D1F] dark:text-[#F5F5F7] opacity-70 hover:opacity-100 transition-opacity flex items-center justify-center"
              title="Instagram"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
              </svg>
            </a>

            <ThemeToggle />
          </div>

        </div>
      </nav>

      <div 
        ref={mobileMenuRef}
        className="md:hidden absolute top-0 left-0 w-full bg-[#F5F5F7] dark:bg-[#000000] hidden z-40 pt-[44px]"
      >
        <div className="px-10 pt-4 pb-20 h-[calc(100vh-44px)] overflow-y-auto">
          <ul ref={menuItemsRef} className="flex flex-col">
            {navItems.map((item) => (
              <li key={item.name} className="border-b border-[#1D1D1F]/10 dark:border-[#F5F5F7]/10 last:border-0">
                <Link
                  href={item.href}
                  className="block py-3 text-2xl font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7] opacity-90 hover:opacity-100"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </header>
  );
}
