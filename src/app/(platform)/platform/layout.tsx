import type { Metadata } from "next";

// Everything under /platform (PO-01B). The console is never indexed; the proxy also sends
// `X-Robots-Tag: noindex, nofollow` on every /platform response.
export const metadata: Metadata = {
  title: "Elite ERP — Platform Owner",
  robots: { index: false, follow: false, nocache: true },
};

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return children;
}
