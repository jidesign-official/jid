import type { Metadata } from "next";
import AdminWorkspace from "@/components/admin/AdminWorkspace";
import { getPortfolioCatalog } from "@/lib/portfolioCatalog";

export const metadata: Metadata = {
  title: "포트폴리오 편집기 - JiD",
  description: "브라우저에서 포트폴리오 초안을 만들고 GitHub 게시 패키지로 내보냅니다.",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminWorkspace projects={getPortfolioCatalog()} />;
}
