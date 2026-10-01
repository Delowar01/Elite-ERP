import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic, IBM_Plex_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { getLocale } from "@/lib/i18n/server";
import { getTheme } from "@/lib/theme";
import "./globals.css";

// Navy Command typography (DEV-UI-01.1). All three families are self-hosted by next/font at build
// time — no runtime request to Google. Weights follow the approved set: 400 body, 500 labels and
// table headers, 600 titles and emphasis (no 800). Plus Jakarta Sans is retired from the UI.

// Latin UI, body and headings.
const body = IBM_Plex_Sans({
  variable: "--font-body-raw",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Arabic UI. Sits after Plex Sans in --font-ui, so Arabic glyphs render in Plex Sans Arabic and Latin
// glyphs keep Plex Sans — mixed Arabic/English stays in one designed family.
const arabic = IBM_Plex_Sans_Arabic({
  variable: "--font-arabic-raw",
  subsets: ["arabic"],
  weight: ["400", "500", "600"],
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
