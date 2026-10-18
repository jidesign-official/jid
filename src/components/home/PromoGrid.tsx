"use client";

import { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { getAssetPath } from "@/lib/basePath";

interface FeaturedProject {
  id: string;
  title: string;
  category: string;
  image: string;
}

export default function PromoGrid({ projects }: { projects: FeaturedProject[] }) {
  const containerRef = useRef<HTMLElement>(null);
  const cardsRef = useRef<(HTMLAnchorElement | null)[]>([]);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      cardsRef.current.forEach((card) => {
        if (!card) return;
        gsap.fromTo(card, { opacity: 0, y: 40 }, {
          opacity: 1,
          y: 0,
          duration: 0.6,
          ease: "power3.out",
          scrollTrigger: {
            trigger: card,
            start: "top 90%",
            toggleActions: "play none none reverse",
          },
        });
      });
    });
    return () => media.revert();
  }, { scope: containerRef, dependencies: [projects] });

  return (
    <section ref={containerRef} aria-label="대표 프로젝트" className="relative isolate w-full max-w-[1440px] mx-auto px-4 py-4 md:py-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {projects.map((project, index) => (
          <Link
            key={project.id}
            href={`/portfolio/${project.id}/`}
            aria-label={`${project.title} 프로젝트 보기`}
            ref={(element) => { cardsRef.current[index] = element; }}
            className="group relative h-[500px] md:h-[580px] overflow-hidden rounded-[5px] bg-[#F5F5F7] dark:bg-[#1C1C1E] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0066CC]"
          >
            <div className="absolute inset-0">
              <Image
                src={getAssetPath(project.image)}
                alt={project.title}
                fill
                sizes="(min-width: 1440px) 696px, (min-width: 768px) calc((100vw - 48px) / 2), calc(100vw - 32px)"
                className="object-cover transition-transform duration-700 group-hover:scale-[1.03] motion-reduce:transition-none"
              />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
