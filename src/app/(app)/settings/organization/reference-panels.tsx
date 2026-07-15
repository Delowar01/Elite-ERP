import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Org } from "@/db";

// Reflects what's actually enforced in code today (requireRole() call sites + nav-config.ts
// role gates), not an editable/configurable matrix — there's no dynamic permissions engine yet,
// so showing a matrix the user could "edit" without it doing anything would be misleading.
const ROWS: { role: string; sales: string; finance: string; configuration: string; payroll: string }[] = [
  { role: "Owner", sales: "Full Access", finance: "Full Access", configuration: "Full Access", payroll: "Full Access" },
  { role: "Admin", sales: "Full Access", finance: "Full Access", configuration: "Full Access", payroll: "Full Access" },
  { role: "Staff", sales: "Full Access", finance: "Full Access", configuration: "No Access", payroll: "No Access" },
];

function accessBadge(value: string) {
  const variant = value === "Full Access" ? "success" : value === "View Only" ? "warning" : "danger";
  return <Badge variant={variant}>{value}</Badge>;
}

export function RolesPermissionsPanel({ locale }: { locale: Locale }) {
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <h3 className="text-[17px] font-bold">{t(locale, "Roles & Permissions")}</h3>
      <p className="text-[12.5px] text-ink-muted -mt-2">
        {t(
          locale,
          "Module access per role, as currently enforced in the app. Assign a member's role from Team. Owner and Admin currently have identical access — role-level differentiation between them isn't built yet.",
        )}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(locale, "Role")}</TableHead>
            <TableHead>{t(locale, "Sales")}</TableHead>
            <TableHead>{t(locale, "Finance")}</TableHead>
            <TableHead>{t(locale, "Configuration")}</TableHead>
            <TableHead>{t(locale, "Payroll")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ROWS.map((row) => (
            <TableRow key={row.role}>
              <TableCell className="font-medium">{t(locale, row.role)}</TableCell>
              <TableCell>{accessBadge(row.sales)}</TableCell>
              <TableCell>{accessBadge(row.finance)}</TableCell>
              <TableCell>{accessBadge(row.configuration)}</TableCell>
              <TableCell>{accessBadge(row.payroll)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-[11px] text-ink-faint">
        {t(locale, "Permanently deleting a record from any Recycle Bin additionally requires Owner or Admin, regardless of module.")}
      </p>
    </div>
  );
}

export function ZatcaPanel({ locale, org }: { locale: Locale; org: Org }) {
  const connected = Boolean(org.zatcaCsid);
  return (
    <div className="max-w-xl">
      <h3 className="text-[17px] font-bold mb-3">{t(locale, "ZATCA E-Invoicing")}</h3>
      <p className="text-[12.5px] text-ink-muted mb-4">
        {t(
          locale,
          "The connection this organization uses to comply with ZATCA Phase 1/2 e-invoicing. The QR code and hash shown on every Tax Invoice come from this integration.",
        )}
      </p>
      <Card>
        <CardContent className="p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-[12.5px] font-semibold">{t(locale, "Integration Status")}</p>
            <Badge variant={connected ? "success" : "neutral"}>{connected ? t(locale, "Connected") : t(locale, "Not Connected")}</Badge>
          </div>
          <div className="flex flex-col gap-2 text-[12.5px]">
            <div className="flex justify-between border-b border-line pb-2">
              <span className="text-ink-faint">CSID</span>
              <span className="font-mono text-xs">{org.zatcaCsid ?? "—"}</span>
            </div>
            <div className="flex justify-between border-b border-line pb-2">
              <span className="text-ink-faint">{t(locale, "Environment")}</span>
              <span>{org.zatcaEnvironment === "production" ? t(locale, "Production") : t(locale, "Sandbox")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-faint">{t(locale, "Certificate expires")}</span>
              <span>{org.zatcaCertExpiresAt ? new Date(org.zatcaCertExpiresAt).toLocaleDateString() : "—"}</span>
            </div>
          </div>
          {!connected && (
            <p className="text-[11px] text-ink-faint">
              {t(locale, "Not connected yet — ZATCA onboarding is built alongside the Invoice module.")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
