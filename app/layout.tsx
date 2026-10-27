import type { Metadata, Viewport } from "next";
import { Manrope, Unbounded } from "next/font/google";
import "./globals.css";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

const body = Manrope({ variable: "--font-body", subsets: ["latin", "latin-ext"], display: "swap" });
const display = Unbounded({
  variable: "--font-display-face",
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: ["500", "700", "800"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME} — kamera bilan boshqariladigan 3D o‘yinlar`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  icons: { icon: "/brand/icon.svg" },
  openGraph: {
    type: "website",
    locale: "uz_UZ",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — tanangiz bilan o‘ynang`,
    description: SITE_DESCRIPTION,
    images: [{ url: "/brand/og.svg", width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_DESCRIPTION, images: ["/brand/og.svg"] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0817" },
  ],
  width: "device-width",
  initialScale: 1,
};

// Runs before first paint: resolves saved/system theme -> data-theme (no flash).
const themeScript = `(function(){try{var p=localStorage.getItem('theme');if(p!=='light'&&p!=='dark')p='system';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.dataset.theme=d?'dark':'light';e.dataset.themePref=p}catch(_){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz" className={`${body.variable} ${display.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
