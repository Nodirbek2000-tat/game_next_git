import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#asosiy"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-solid focus:px-4 focus:py-3 focus:font-bold"
      >
        Asosiy mazmunga o‘tish
      </a>
      <Header />
      <main id="asosiy" className="flex-1">
        {children}
      </main>
      <Footer />
    </>
  );
}
