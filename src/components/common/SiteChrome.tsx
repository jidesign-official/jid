"use client";

import { usePathname } from "next/navigation";
import GNB from "./GNB";
import Footer from "./Footer";

export default function SiteChrome({ slot }: { slot: "header" | "footer" }) {
  const pathname = usePathname();
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return null;
  return slot === "header" ? <GNB /> : <Footer />;
}
