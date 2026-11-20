import Link from "next/link";
import { FooterContact } from "@/components/account/footer-contact";
import { SITE_NAME } from "@/lib/site";

export function Footer() {
  return (
    <footer className="mx-auto flex w-full max-w-[72rem] flex-wrap items-center justify-center gap-x-6 gap-y-1 px-5 py-6 text-sm text-muted sm:px-8">
      <FooterContact />
      <span>© {SITE_NAME}</span>
      <Link href="/reyting" className="inline-flex min-h-10 items-center font-semibold hover:text-brand">
        Reyting
      </Link>
      <Link href="/premium" className="inline-flex min-h-10 items-center font-semibold hover:text-brand">
        Premium
      </Link>
      <span className="w-full text-center text-xs opacity-70">
        Nurli tor ovozlari: University of Iowa MIS (gitara), VSCO 2 CE (arfa) —{" "}
        <a href="https://github.com/nbrosowsky/tonejs-instruments" target="_blank" rel="noopener noreferrer" className="underline hover:text-brand">
          tonejs-instruments
        </a>
        , CC-BY 3.0
      </span>
    </footer>
  );
}
