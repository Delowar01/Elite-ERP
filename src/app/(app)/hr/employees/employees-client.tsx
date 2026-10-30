"use client";

import { useMemo, useState } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import Link from "next/link";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n/dict";
import { statusStat } from "@/lib/status-registry";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatRow } from "../../sales/_shared/stat-row";

export type EmployeeCardRow = {
  id: number;
  employeeCode: string;
  name: string;
  designation: string | null;
  departmentId: number | null;
  departmentName: string | null;
  status: string;
  todayStatus: string | null; // present | late | absent | on_leave | null (no record today)
};

// Same fixed gradient pool used by the kanban board and the mockup's emp-cards,
// keyed by employee id so each person keeps one color everywhere.
const AVATAR_GRADIENTS = [
  "linear-gradient(135deg,#3A5AC9,#22235E)",
  "linear-gradient(135deg,var(--brand-orange-light),var(--brand-orange))",
  "linear-gradient(135deg,#5C5D82,#22235E)",
  "linear-gradient(135deg,#1E8E5A,#124A31)",
];

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}


export function EmployeesClient({
  locale,
  rows,
  departments,
}: {
  locale: Locale;
  rows: EmployeeCardRow[];
  departments: { id: number; name: string }[];
}) {
  const [activeDept, setActiveDept] = useState<number | null>(null);

  const filtered = useMemo(() => (activeDept === null ? rows : rows.filter((r) => r.departmentId === activeDept)), [rows, activeDept]);

  const presentToday = rows.filter((r) => r.todayStatus === "present" || r.todayStatus === "late").length;
  const onLeaveToday = rows.filter((r) => r.todayStatus === "on_leave").length;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title={t(locale, "Employees")}
        actions={
          <Link href="/hr/employees/new" className="btn btn-primary" style={{ width: "auto", padding: "0 18px" }}>
            <Plus className="size-3.5" /> {t(locale, "Add Employee")}
          </Link>
        }
      />

      {/* Department filter: real toggle buttons — Tab reaches each, Enter / Space choose it, the chosen one is
          aria-pressed — on the same .tab row. Filtering is unchanged. */}
      <div className="tab-row">
        <button type="button" className={cn("tab", activeDept === null && "active")} aria-pressed={activeDept === null} onClick={() => setActiveDept(null)}>
          {t(locale, "All departments")}
        </button>
        {departments.map((d) => (
          <button key={d.id} type="button" className={cn("tab", activeDept === d.id && "active")} aria-pressed={activeDept === d.id} onClick={() => setActiveDept(d.id)}>
            {d.name}
          </button>
        ))}
      </div>

      {/* Present and On Leave are attendance statuses: label, tone and colour come from the status registry
          (statusStat), Present keeping its "Present today" wording. Headcount and Departments are plain counts. */}
      <StatRow
        items={[
          { label: t(locale, "Headcount"), value: rows.length },
          { ...statusStat(locale, "attendance", "present", presentToday), label: t(locale, "Present today") },
          statusStat(locale, "attendance", "on_leave", onLeaveToday),
          { label: t(locale, "Departments"), value: departments.length },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState message={t(locale, "No employees yet. Add your first employee.")} />
      ) : (
        <div className="emp-grid">
          {filtered.map((r) => {
            const roleLine = [r.designation, r.departmentName].filter(Boolean).join(" · ");
            return (
              <Link key={r.id} href={`/hr/employees/${r.id}`} className="card emp-card hover:border-brand-orange transition-colors">
                <div className="avatar" style={{ background: AVATAR_GRADIENTS[r.id % AVATAR_GRADIENTS.length] }}>
                  {initials(r.name)}
                </div>
                <div>
                  <div className="emp-name">{r.name}</div>
                  <div className="emp-role">{roleLine || r.employeeCode}</div>
                  <div className="emp-meta">
                    {r.status === "inactive" ? (
                      <StatusBadge domain="employee" status="inactive" locale={locale} />
                    ) : (
                      r.todayStatus && <StatusBadge domain="attendance" status={r.todayStatus} locale={locale} />
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
