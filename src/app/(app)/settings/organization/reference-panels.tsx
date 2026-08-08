import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { t, type Locale } from "@/lib/i18n/dict";
import { MODULE_ACCESS, RESTRICTED_ACTIONS, type Access, type RoleKey } from "@/lib/role-matrix";

// Rendered from src/lib/role-matrix.ts, which a check asserts against the real guards in both
// directions. This panel used to be hand-written prose describing checks that live elsewhere, and
// it drifted: it claimed Owner and Admin were identical (permanent delete is owner-only), claimed
// Staff had full Finance access (they cannot delete a payment), and omitted four modules entirely.
// Editing the copy here without editing the matrix — or adding a role gate without updating it —
// now fails the check rather than going unnoticed.

function accessBadge(locale: Locale, value: Access) {
  const label = value === "full" ? "Full Access" : value === "view" ? "View Only" : "No Access";
  const variant = value === "full" ? "success" : value === "view" ? "warning" : "danger";
  return <Badge variant={variant}>{t(locale, label)}</Badge>;
}

const ROLE_LABEL: Record<RoleKey, string> = { owner: "Owner", admin: "Admin", staff: "Staff" };

export function RolesPermissionsPanel({ locale }: { locale: Locale }) {
  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <h3 className="text-[17px] font-bold">{t(locale, "Roles & Permissions")}</h3>
      <p className="text-[12.5px] text-ink-muted -mt-3">
        {t(
          locale,
          "Access per role, as enforced by the application. Assign a member's role from Team. There are three fixed roles — per-module and custom roles are not built yet.",
        )}
      </p>

      <div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Module")}</TableHead>
              <TableHead>{t(locale, "Owner")}</TableHead>
              <TableHead>{t(locale, "Admin")}</TableHead>
              <TableHead>{t(locale, "Staff")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MODULE_ACCESS.map((row) => (
              <TableRow key={row.module}>
                <TableCell>
                  <div className="font-medium">{t(locale, row.module)}</div>
                  {row.note && <div className="text-[11px] text-ink-faint mt-0.5">{t(locale, row.note)}</div>}
                </TableCell>
                <TableCell>{accessBadge(locale, row.owner)}</TableCell>
                <TableCell>{accessBadge(locale, row.admin)}</TableCell>
                <TableCell>{accessBadge(locale, row.staff)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div>
        <h4 className="text-[13.5px] font-bold mb-1">{t(locale, "Actions restricted beyond their module")}</h4>
        <p className="text-[11.5px] text-ink-muted mb-2">
          {t(locale, "These are refused by the server, not merely hidden.")}
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Action")}</TableHead>
              <TableHead>{t(locale, "Allowed for")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {RESTRICTED_ACTIONS.map((row) => (
              <TableRow key={row.action}>
                <TableCell>
                  <div className="font-medium">{t(locale, row.action)}</div>
                  <div className="text-[11px] text-ink-faint mt-0.5">{t(locale, row.reason)}</div>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.allowed.map((r) => t(locale, ROLE_LABEL[r])).join(" · ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-[11px] text-ink-faint">
        {t(
          locale,
          "Staff can create, send and void invoices, issue credit and debit notes, receive purchase orders and post journal entries. Those actions affect the ledger and are not currently restricted by role.",
        )}
      </p>
    </div>
  );
}

