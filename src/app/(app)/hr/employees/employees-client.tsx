"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n/dict";

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

function todayPill(locale: Locale, todayStatus: string | null): { label: string; cls: string } | null {
  if (todayStatus === "on_leave") return { label: t(locale, "On leave"), cls: "pill-warning" };
  if (todayStatus === "late") return { label: t(locale, "Late"), cls: "pill-warning" };
  if (todayStatus === "present") return { label: t(locale, "Present"), cls: "pill-success" };
  if (todayStatus === "absent") return { label: t(locale, "Absent"), cls: "pill-neutral" };
  return null;
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
      <div className="main-head">
        <h3>{t(locale, "Employees")}</h3>
        <Link href="/hr/employees/new" className="btn btn-primary" style={{ width: "auto", padding: "0 18px" }}>
          <Plus className="size-3.5" /> {t(locale, "Add Employee")}
        </Link>
      </div>

      <div className="tab-row">
        <span className={cn("tab", activeDept === null && "active")} onClick={() => setActiveDept(null)}>
          {t(locale, "All departments")}
        </span>
        {departments.map((d) => (
          <span key={d.id} className={cn("tab", activeDept === d.id && "active")} onClick={() => setActiveDept(d.id)}>
            {d.name}
          </span>
        ))}
      </div>

      <div className="stat-row-2">
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>{t(locale, "Headcount")}</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, marginTop: 4 }}>{rows.length}</div>
        </div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>{t(locale, "Present today")}</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, marginTop: 4, color: "var(--accent-green)" }}>
            {presentToday}
          </div>
        </div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>{t(locale, "On leave")}</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, marginTop: 4, color: "var(--warning)" }}>
            {onLeaveToday}
          </div>
        </div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>{t(locale, "Departments")}</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, marginTop: 4 }}>{departments.length}</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface shadow-elevated py-12 text-center text-ink-muted text-sm">
          {t(locale, "No employees yet. Add your first employee.")}
        </div>
      ) : (
        <div className="emp-grid">
          {filtered.map((r) => {
            const pill = todayPill(locale, r.todayStatus);
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
                      <span className="pill pill-neutral">{t(locale, "inactive")}</span>
                    ) : (
                      pill && <span className={cn("pill", pill.cls)}>{pill.label}</span>
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
