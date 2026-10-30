import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";

// Mirrors the mockup's departments_main placeholder: departments have no standalone management
// screen — they're the filter tabs on Employees, and the names themselves are a Presets library.
export default async function DepartmentsPage() {
  await requireSession();
  const locale = await getLocale();

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title={t(locale, "Departments")} />
      <EmptyState
        message={t(locale, "Managed from the Employees screen")}
        hint={
          // The placeholder's reading measure (46ch), centred.
          <span className="inline-block max-w-[46ch]">
            {t(locale, "Departments are the filter tabs at the top of Employees (All departments / Operations / Finance / Logistics / Sales) — there's no separate management screen.")}{" "}
            {t(locale, "Department names are managed in Preset Management → Departments; each employee picks one on their profile.")}
          </span>
        }
        action={
          <>
            <Link href="/hr/employees" className="btn btn-primary" style={{ width: "auto", padding: "0 18px" }}>
              {t(locale, "Go to Employees")}
            </Link>
            <Link href="/settings/presets" className="btn btn-glass" style={{ width: "auto", padding: "0 18px" }}>
              {t(locale, "Go to Preset Management")}
            </Link>
          </>
        }
      />
    </div>
  );
}
