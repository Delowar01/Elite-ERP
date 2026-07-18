import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";

export default async function AppNotFound() {
  const locale = await getLocale();
  return (
    <div className="max-w-md mx-auto text-center py-20">
      <div
        className="mx-auto mb-5 flex items-center justify-center rounded-2xl"
        style={{ width: 56, height: 56, background: "var(--canvas)", border: "1px solid var(--line)" }}
      >
        <FileQuestion className="size-7" style={{ color: "var(--brand-orange)" }} />
      </div>
      <h3 className="text-[19px] font-bold mb-2">{t(locale, "Page not found")}</h3>
      <p className="text-ink-muted text-sm mb-6">{t(locale, "The page you're looking for doesn't exist or may have moved.")}</p>
      <Link href="/dashboard" className="btn btn-primary" style={{ width: "auto", padding: "0 18px", display: "inline-flex" }}>
        {t(locale, "Back to Dashboard")}
      </Link>
    </div>
  );
}
