import type { Metadata } from "next";
import Link from "next/link";
import {
  aboutIntroduction,
  aboutPhilosophy,
  aboutServices,
  companyHistory,
} from "@/data/about";

export const metadata: Metadata = {
  title: "About Us - JiD",
  description: aboutIntroduction.paragraph,
};

export default function AboutPage() {
  return (
    <article
      aria-label="About JiD"
      className="min-h-screen bg-[#F5F5F7] text-[#1D1D1F] dark:bg-[#111111] dark:text-[#F5F5F7]"
    >
      <div className="mx-auto max-w-[1024px] px-6 sm:px-10">
        <section
          aria-labelledby="about-introduction"
          className="pb-24 pt-20 sm:pb-32 sm:pt-28 lg:pb-40 lg:pt-36"
        >
          <p lang="en" className="mb-8 text-sm font-medium tracking-[0.02em] sm:mb-10">
            About Us
          </p>
          <h1
            id="about-introduction"
            lang="en"
            className="font-product max-w-[850px] text-[clamp(2.5rem,6.5vw,5rem)] leading-[1.08] tracking-[-0.045em] [overflow-wrap:anywhere] [text-wrap:balance]"
          >
            {aboutIntroduction.title}
          </h1>
          <p lang="ko" className="mt-8 text-xl font-medium leading-relaxed tracking-[-0.025em] sm:mt-10 sm:text-2xl">
            {aboutIntroduction.subtitle}
          </p>
          <p lang="ko" className="mt-5 max-w-[640px] text-base leading-[1.9] text-[#1D1D1F]/75 dark:text-[#F5F5F7]/75 sm:text-lg">
            {aboutIntroduction.paragraph}
          </p>
          <nav lang="en" aria-label="Explore JiD" className="mt-10 flex flex-wrap items-center gap-3 sm:mt-12 sm:gap-4">
            <Link
              href="/portfolio"
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-3 rounded-full bg-[#0066CC] px-6 py-3 text-sm font-medium text-white hover:bg-[#0055aa] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0066CC] dark:focus-visible:outline-[#2997ff]"
            >
              View Portfolio <span aria-hidden="true">↗</span>
            </Link>
            <Link
              href="/contact"
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-3 rounded-full px-6 py-3 text-sm font-medium text-[#0066CC] hover:bg-[#0066CC]/5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0066CC] dark:text-[#2997ff] dark:hover:bg-[#2997ff]/10 dark:focus-visible:outline-[#2997ff]"
            >
              Start a Project <span aria-hidden="true">→</span>
            </Link>
          </nav>
        </section>

        <section aria-labelledby="about-philosophy" className="pb-24 sm:pb-32 lg:pb-40">
          <h2 id="about-philosophy" lang="en" className="mb-10 text-sm font-medium tracking-[0.02em] sm:mb-14">
            Design Philosophy
          </h2>
          <div>
            {aboutPhilosophy.map((block) => (
              <section
                key={block.id}
                aria-labelledby={block.id}
                className="grid gap-7 border-t border-[#1D1D1F]/15 py-10 first:pt-10 last:pb-0 dark:border-[#F5F5F7]/15 sm:gap-10 sm:py-14 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-16"
              >
                <h3
                  id={block.id}
                  lang="en"
                  className="font-product max-w-[420px] text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.2] tracking-[-0.03em] [overflow-wrap:anywhere] [text-wrap:balance]"
                >
                  {block.title}
                </h3>
                <div className="min-w-0">
                  <p lang="ko" className="text-lg font-medium leading-relaxed tracking-[-0.02em]">
                    {block.subtitle}
                  </p>
                  <p lang="ko" className="mt-4 text-base leading-[1.9] text-[#1D1D1F]/75 dark:text-[#F5F5F7]/75">
                    {block.paragraph}
                  </p>
                </div>
              </section>
            ))}
          </div>
        </section>

        <section aria-labelledby="about-history" className="pb-24 sm:pb-32 lg:pb-40">
          <h2
            id="about-history"
            lang="en"
            className="font-product mb-10 text-[clamp(2rem,4vw,3rem)] leading-[1.15] tracking-[-0.035em] [overflow-wrap:anywhere] sm:mb-14"
          >
            Company History
          </h2>
          <ol aria-label="Company history by year" role="list">
            {companyHistory.map(({ year, events }) => (
              <li
                key={year}
                className="grid gap-5 border-t border-[#1D1D1F]/15 py-8 dark:border-[#F5F5F7]/15 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-12 sm:py-10"
              >
                <time
                  dateTime={year}
                  className="font-product text-3xl leading-tight tracking-[-0.03em] tabular-nums sm:text-4xl"
                >
                  {year}
                </time>
                <ul lang="ko" role="list" className="min-w-0 space-y-2 text-base leading-[1.8] text-[#1D1D1F]/75 dark:text-[#F5F5F7]/75">
                  {events.map((event) => (
                    <li key={event} className="relative pl-4 before:absolute before:left-0 before:top-[0.8em] before:h-1 before:w-1 before:rounded-full before:bg-current">
                      {event}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="about-services" className="pb-24 sm:pb-32 lg:pb-40">
          <h2
            id="about-services"
            lang="en"
            className="font-product mb-10 text-[clamp(2rem,4vw,3rem)] leading-[1.15] tracking-[-0.035em] [overflow-wrap:anywhere] sm:mb-14"
          >
            Our Services
          </h2>
          <dl>
            {aboutServices.map((service) => (
              <div
                key={service.name}
                className="grid gap-4 border-t border-[#1D1D1F]/15 py-8 dark:border-[#F5F5F7]/15 sm:py-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-16"
              >
                <dt lang="en" className="font-product text-2xl leading-[1.25] tracking-[-0.025em] [overflow-wrap:anywhere] sm:text-3xl">
                  {service.name}
                </dt>
                <dd lang="ko" className="min-w-0 text-base leading-[1.8] text-[#1D1D1F]/75 dark:text-[#F5F5F7]/75">
                  {service.description}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </article>
  );
}
