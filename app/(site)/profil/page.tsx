import type { Metadata } from "next";
import { ComingSoon, PageHeader } from "@/components/site/page-shell";

export const metadata: Metadata = {
  title: "Profil",
  description: "Shaxsiy profil — tez orada.",
  alternates: { canonical: "/profil" },
};

export default function ProfilePage() {
  return (
    <>
      <PageHeader title="Profil" />
      <ComingSoon icon="🧑‍🚀" title="Tez orada">
        <p>Hozircha mehmon sifatida o‘ynang.</p>
      </ComingSoon>
    </>
  );
}
