import Link from "next/link";
import { Building2 } from "lucide-react";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";

// Mirrors the mockup's departments_main placeholder: departments have no standalone management
// screen — they're the filter tabs on Employees, and the names themselves are a Presets library.
export default async function DepartmentsPage() {
  await requireSession();
  const locale = await getLocale();

  return (
    <div className="max-w-6xl mx-auto">
      <div className="main-head">
        <h3>{t(locale, "Departments")}</h3>
      </div>
      <div className="card" style={{ padding: "52px 32px", textAlign: "center" }}>
        <div
          className="mx-auto mb-3.5 flex items-center justify-center rounded-2xl"
          style={{ width: 52, height: 52, background: "var(--surface-raised, var(--canvas))", border: "1px solid var(--line)" }}
        >
          <Building2 className="size-6" style={{ color: "var(--brand-orange)" }} />
        </div>
        <div className="text-[14px] font-bold">{t(locale, "Managed from the Employees screen")}</div>
        <p className="text-[12.5px] text-ink-muted mx-auto mt-1.5 mb-4" style={{ maxWidth: "46ch" }}>
          {t(locale, "Departments are the filter tabs at the top of Employees (All departments / Operations / Finance / Logistics / Sales) — there's no separate management screen.")}{" "}
          {t(locale, "Department names are managed in Preset Management → Departments; each employee picks one on their profile.")}
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link href="/hr/employees" className="btn btn-primary" style={{ width: "auto", padding: "0 18px" }}>
            {t(locale, "Go to Employees")}
          </Link>
          <Link href="/settings/presets" className="btn btn-glass" style={{ width: "auto", padding: "0 18px" }}>
            {t(locale, "Go to Preset Management")}
          </Link>
        </div>
      </div>
    </div>
  );
}
