import type { Metadata } from "next";
import { ComingSoon, PageHeader } from "@/components/site/page-shell";

export const metadata: Metadata = {
  title: "Kirish",
  description: "Kirish tez orada. Mehmon sifatida ro‘yxatdan o‘tmasdan o‘ynash mumkin.",
  alternates: { canonical: "/kirish" },
};

export default function SignInPage() {
  return (
    <>
      <PageHeader title="Kirish" />
      <ComingSoon icon="🔑" title="Tez orada">
        <p>Ro‘yxatdan o‘tmasdan o‘ynashingiz mumkin.</p>
      </ComingSoon>
    </>
  );
}
