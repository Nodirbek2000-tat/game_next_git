import type { Metadata } from "next";
import { PremiumPage } from "@/components/account/premium-page";

export const metadata: Metadata = {
  title: "Premium",
  description: "Premium: barcha o‘yinlar va fitnes. Telegram bot orqali to‘lov.",
  alternates: { canonical: "/premium" },
};

export default function Page() {
  return <PremiumPage />;
}
