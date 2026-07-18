import { Printer } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";

// Plain anchor (not next/link): the print view opens in a new tab and needs no client nav state.
export function PrintButton({ locale, href }: { locale: Locale; href: string }) {
  return (
    <a className="btn btn-glass" style={{ width: "auto", padding: "0 14px" }} href={href} target="_blank" rel="noreferrer">
      <Printer className="size-3.5" /> {t(locale, "Print / Download PDF")}
    </a>
  );
}
