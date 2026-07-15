import { eq, asc } from "drizzle-orm";
import { db, orgsTable, bankAccountsTable, noteTemplatesTable, usersTable } from "@/db";
import { requireRole } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { SettingsNav, SettingsNavList, SettingsNavGroupLabel, SettingsNavItem, SettingsNavContent } from "@/components/ui/settings-nav";
import { BusinessDetailsForm, LogoPanel, ColorThemePanel } from "./company-panels";
import { SealSignaturePanel, PrintLayoutPanel, DefaultTermsSummary } from "./documents-panels";
import { DefaultBankAccountPanel, FiscalYearPanel, VatConfigurationPanel } from "./finance-panel";
import { RolesPermissionsPanel, ZatcaPanel } from "./reference-panels";
import { TeamPanel } from "../team/team-panel";

export default async function OrganizationSettingsPage() {
  const session = await requireRole("owner", "admin");
  const locale = await getLocale();

  const [org] = await db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId));
  const bankAccounts = await db
    .select()
    .from(bankAccountsTable)
    .where(eq(bankAccountsTable.orgId, session.orgId))
    .orderBy(asc(bankAccountsTable.name));
  const noteTemplates = await db
    .select()
    .from(noteTemplatesTable)
    .where(eq(noteTemplatesTable.orgId, session.orgId));
  const members = await db.select().from(usersTable).where(eq(usersTable.orgId, session.orgId)).orderBy(asc(usersTable.name));

  return (
    <div className="max-w-5xl">
      <SettingsNav defaultValue="color-theme" orientation="vertical" className="flex gap-8 items-start">
        <SettingsNavList>
          <SettingsNavGroupLabel>{t(locale, "Company")}</SettingsNavGroupLabel>
          <SettingsNavItem value="business-details">{t(locale, "Business Details")}</SettingsNavItem>
          <SettingsNavItem value="logo">{t(locale, "Logo")}</SettingsNavItem>
          <SettingsNavItem value="color-theme">{t(locale, "Color Theme")}</SettingsNavItem>

          <SettingsNavGroupLabel>{t(locale, "Documents")}</SettingsNavGroupLabel>
          <SettingsNavItem value="default-terms">{t(locale, "Default Terms & Conditions")}</SettingsNavItem>
          <SettingsNavItem value="seal-signature">{t(locale, "Seal & Signature")}</SettingsNavItem>
          <SettingsNavItem value="print-layout">{t(locale, "Print Layout")}</SettingsNavItem>

          <SettingsNavGroupLabel>{t(locale, "Finance")}</SettingsNavGroupLabel>
          <SettingsNavItem value="default-bank">{t(locale, "Default Bank Account")}</SettingsNavItem>
          <SettingsNavItem value="fiscal-year">{t(locale, "Fiscal Year")}</SettingsNavItem>
          <SettingsNavItem value="vat-config">{t(locale, "VAT Configuration")}</SettingsNavItem>

          <SettingsNavGroupLabel>{t(locale, "Users")}</SettingsNavGroupLabel>
          <SettingsNavItem value="team">{t(locale, "Team")}</SettingsNavItem>
          <SettingsNavItem value="roles-permissions">{t(locale, "Roles & Permissions")}</SettingsNavItem>

          <SettingsNavGroupLabel>{t(locale, "Integrations")}</SettingsNavGroupLabel>
          <SettingsNavItem value="zatca">{t(locale, "ZATCA E-Invoicing")}</SettingsNavItem>
        </SettingsNavList>

        <SettingsNavContent value="business-details">
          <BusinessDetailsForm locale={locale} org={org} />
        </SettingsNavContent>
        <SettingsNavContent value="logo">
          <LogoPanel locale={locale} org={org} />
        </SettingsNavContent>
        <SettingsNavContent value="color-theme">
          <ColorThemePanel locale={locale} org={org} />
        </SettingsNavContent>
        <SettingsNavContent value="default-terms">
          <DefaultTermsSummary locale={locale} templates={noteTemplates} />
        </SettingsNavContent>
        <SettingsNavContent value="seal-signature">
          <SealSignaturePanel locale={locale} org={org} />
        </SettingsNavContent>
        <SettingsNavContent value="print-layout">
          <PrintLayoutPanel locale={locale} org={org} />
        </SettingsNavContent>
        <SettingsNavContent value="default-bank">
          <DefaultBankAccountPanel locale={locale} org={org} bankAccounts={bankAccounts} />
        </SettingsNavContent>
        <SettingsNavContent value="fiscal-year">
          <FiscalYearPanel locale={locale} org={org} />
        </SettingsNavContent>
        <SettingsNavContent value="vat-config">
          <VatConfigurationPanel locale={locale} org={org} />
        </SettingsNavContent>
        <SettingsNavContent value="team">
          <TeamPanel locale={locale} members={members} currentUserId={session.userId} currentUserRole={session.role} />
        </SettingsNavContent>
        <SettingsNavContent value="roles-permissions">
          <RolesPermissionsPanel locale={locale} />
        </SettingsNavContent>
        <SettingsNavContent value="zatca">
          <ZatcaPanel locale={locale} org={org} />
        </SettingsNavContent>
      </SettingsNav>
    </div>
  );
}
