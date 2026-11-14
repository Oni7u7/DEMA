import type { Metadata } from "next";
import "./globals.css";
import { LanguageToggle, LocaleProvider } from "@/components/Locale";
import Providers from "@/components/Providers";
import { SITE } from "@/lib/site";
import { AmbientBackground } from "@/components/AmbientBackground";
import { THEME_SCRIPT, ThemeToggle } from "@/components/ThemeToggle";

const TITLE = "Cuadra — divide la cuenta y que cada quien pague su parte con CoDi";
const DESCRIPTION =
  "Divide un gasto en la mesa con un QR. Cada persona recibe su cobro CoDi y una sola pantalla muestra quién ya pagó y cuánto falta, sin juntar comprobantes.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  alternates: { canonical: "/" },
  title: { default: TITLE, template: "%s · Cuadra" },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: SITE,
    siteName: "Cuadra",
    locale: "es_MX",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/brand/logo.png", alt: "Cuadra" }],
  },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION, images: ["/brand/logo.png"] },
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f3f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1319" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Before first paint: pick light or dark so there is no flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <AmbientBackground />
        <LocaleProvider>
          <Providers>
            <div className="top-controls">
              <ThemeToggle />
              <LanguageToggle />
            </div>
            {children}
          </Providers>
        </LocaleProvider>
      </body>
    </html>
  );
}
