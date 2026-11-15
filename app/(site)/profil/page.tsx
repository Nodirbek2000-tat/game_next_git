import type { Metadata } from "next";
import { ProfilePage } from "@/components/account/profile-page";

export const metadata: Metadata = {
  title: "Profil",
  description: "Akkaunt: premium muddati, qurilmalar, chiqish.",
  alternates: { canonical: "/profil" },
};

export default function Page() {
  return <ProfilePage />;
}
