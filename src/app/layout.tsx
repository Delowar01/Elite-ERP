import type { Metadata } from "next";
import { Inter, IBM_Plex_Sans_Arabic, IBM_Plex_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { getLocale } from "@/lib/i18n/server";
import { getTheme } from "@/lib/theme";
import "./globals.css";

// Typography (LCP design adoption; structure from DEV-UI-01.1). All three families are self-hosted by
// next/font at build time — no runtime request to Google and no font binary in the repository. Weights
// follow the LCP set: 400 body, 500 labels and controls, 600 titles and emphasis, 700 page titles and
// KPI values.

// Latin UI, body and headings: Inter, the Lead Capture Pro face.
const body = Inter({
  variable: "--font-body-raw",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Arabic UI. Sits after Inter in --font-ui (Inter ships no Arabic), so Arabic glyphs render in IBM
// Plex Sans Arabic and Latin glyphs keep Inter — mixed Arabic/English text stays legible in one stack.
const arabic = IBM_Plex_Sans_Arabic({
  variable: "--font-arabic-raw",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
});

// Codes, IDs and hashes only — never money.
const mono = IBM_Plex_Mono({
  variable: "--font-mono-raw",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Elite ERP",
  description: "Elite Innovation Solutions — ERP",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const theme = await getTheme();

  return (
    <html
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      data-theme={theme ?? undefined}
      className={`${body.variable} ${arabic.variable} ${mono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
