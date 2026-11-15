import type { Metadata } from "next";
import { AdminPanel } from "@/components/account/admin-panel";

export const metadata: Metadata = {
  title: "Admin panel",
  robots: { index: false },
};

export default function Page() {
  return <AdminPanel />;
}
