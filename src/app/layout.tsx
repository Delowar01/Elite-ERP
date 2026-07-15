import type { Metadata } from "next";
import { Plus_Jakarta_Sans, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { getLocale } from "@/lib/i18n/server";
import "./globals.css";

const display = Plus_Jakarta_Sans({
  variable: "--font-display-raw",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const body = IBM_Plex_Sans({
  variable: "--font-body-raw",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

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

  return (
    <html
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
