import type { Metadata } from "next";
import AdminWorkspace from "@/components/admin/AdminWorkspace";
import { getPortfolioCatalog } from "@/lib/portfolioCatalog";

export const metadata: Metadata = {
  title: "포트폴리오 편집기 - JiD",
  description: "브라우저에서 포트폴리오 초안을 만들고 GitHub 게시 패키지로 내보냅니다.",
  // Crawlers must be able to read this prerendered noindex; do not disallow the
  // path in robots.txt, which could leave a URL-only result in search indexes.
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
    noimageindex: true,
    googleBot: {
      index: false,
      follow: false,
      nosnippet: true,
      noimageindex: true,
    },
  },
};

export default function AdminPage() {
  return <AdminWorkspace projects={getPortfolioCatalog()} />;
}
