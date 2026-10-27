import Link from "next/link";
import { SITE_NAME } from "@/lib/site";

export function Footer() {
  return (
    <footer className="mx-auto flex w-full max-w-[72rem] flex-wrap items-center justify-center gap-x-6 gap-y-1 px-5 py-6 text-sm text-muted sm:px-8">
      <span>© {SITE_NAME}</span>
      <Link href="/reyting" className="inline-flex min-h-10 items-center font-semibold hover:text-brand">
        Reyting
      </Link>
      <Link href="/kirish" className="inline-flex min-h-10 items-center font-semibold hover:text-brand">
        Kirish
      </Link>
    </footer>
  );
}
