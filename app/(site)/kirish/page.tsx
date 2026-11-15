import type { Metadata } from "next";
import { Suspense } from "react";
import { SignIn } from "@/components/account/sign-in";

export const metadata: Metadata = {
  title: "Kirish",
  description: "Akkauntga kirish: Telegram orqali yoki login va parol bilan.",
  alternates: { canonical: "/kirish" },
};

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="min-h-[60dvh]" />}>
      <SignIn />
    </Suspense>
  );
}
