"use client";

import { usePathname } from "next/navigation";
import GNB from "./GNB";
import Footer from "./Footer";
import { ADMIN_ROUTE } from "@/lib/adminRoute";

export default function SiteChrome({ slot }: { slot: "header" | "footer" }) {
  const pathname = usePathname();
  if (pathname === ADMIN_ROUTE || pathname.startsWith(`${ADMIN_ROUTE}/`)) return null;
  return slot === "header" ? <GNB /> : <Footer />;
}
