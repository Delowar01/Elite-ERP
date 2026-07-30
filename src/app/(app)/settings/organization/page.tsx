import { eq, asc } from "drizzle-orm";
import { db, orgsTable, bankAccountsTable, usersTable } from "@/db";
import { requireRole } from "@/lib/session";
import { getProfileByCountryName, profileHasFeature } from "@/lib/geo/country-profiles";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { SettingsNav, SettingsNavList, SettingsNavGroupLabel, SettingsNavItem, SettingsNavContent } from "@/components/ui/settings-nav";
import { BusinessDetailsForm, LogoPanel, ColorThemePanel } from "./company-panels";
import { DefaultBankAccountPanel, FiscalYearPanel, VatConfigurationPanel } from "./finance-panel";
import { NumberFormatPanel } from "./number-format-panel";
import { RolesPermissionsPanel } from "./reference-panels";
import { ZatcaPanel } from "./zatca-panel";
import { TeamPanel } from "../team/team-panel";

// Print Layout, Seal & Signature, and Terms & Conditions are managed under Preset Management,
// not Business Settings (they are per-document presets, not company profile fields).
const SETTINGS_TABS = new Set([
  "business-details", "logo", "color-theme",
  "default-bank", "fiscal-year", "vat-config", "number-format", "team", "roles-permissions", "zatca",
]);

export default async function OrganizationSettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await requireRole("owner", "admin");
  const locale = await getLocale();
  const { tab } = await searchParams;

  const [org] = await db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId));
  // Country-specific settings: ZATCA E-Invoicing only appears for profiles that enable it (Saudi Arabia).
  const countryProfile = getProfileByCountryName(org.country);
  const showZatca = profileHasFeature(countryProfile, "zatca_phase1");
  const requestedTab = tab && SETTINGS_TABS.has(tab) ? tab : "color-theme";
  const defaultTab = requestedTab === "zatca" && !showZatca ? "color-theme" : requestedTab;
  const bankAccounts = await db
    .select()
    .from(bankAccountsTable)
    .where(eq(bankAccountsTable.orgId, session.orgId))
    .orderBy(asc(bankAccountsTable.name));
  const members = await db.select().from(usersTable).where(eq(usersTable.orgId, session.orgId)).orderBy(asc(usersTable.name));

  return (
    <div className="max-w-5xl mx-auto">
      <SettingsNav defaultValue={defaultTab} orientation="vertical" className="flex gap-8 items-start">
        <SettingsNavList>
          <SettingsNavGroupLabel>{t(locale, "Company")}</SettingsNavGroupLabel>
          <SettingsNavItem value="business-details">{t(locale, "Business Details")}</SettingsNavItem>
          <SettingsNavItem value="logo">{t(locale, "Logo")}</SettingsNavItem>
          <SettingsNavItem value="color-theme">{t(locale, "Color Theme")}</SettingsNavItem>

          <SettingsNavGroupLabel>{t(locale, "Finance")}</SettingsNavGroupLabel>
          <SettingsNavItem value="default-bank">{t(locale, "Default Bank Account")}</SettingsNavItem>
          <SettingsNavItem value="fiscal-year">{t(locale, "Fiscal Year")}</SettingsNavItem>
          <SettingsNavItem value="vat-config">{t(locale, "VAT Configuration")}</SettingsNavItem>
          <SettingsNavItem value="number-format">{t(locale, "Number Format")}</SettingsNavItem>

          <SettingsNavGroupLabel>{t(locale, "Users")}</SettingsNavGroupLabel>
          <SettingsNavItem value="team">{t(locale, "Team")}</SettingsNavItem>
          <SettingsNavItem value="roles-permissions">{t(locale, "Roles & Permissions")}</SettingsNavItem>

          {showZatca && (
            <>
              <SettingsNavGroupLabel>{t(locale, "Integrations")}</SettingsNavGroupLabel>
              <SettingsNavItem value="zatca">{t(locale, "ZATCA E-Invoicing")}</SettingsNavItem>
            </>
          )}
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
        <SettingsNavContent value="default-bank">
          <DefaultBankAccountPanel locale={locale} org={org} bankAccounts={bankAccounts} />
        </SettingsNavContent>
        <SettingsNavContent value="fiscal-year">
          <FiscalYearPanel locale={locale} org={org} />
        </SettingsNavContent>
        <SettingsNavContent value="vat-config">
          <VatConfigurationPanel locale={locale} org={org} />
        </SettingsNavContent>
        <SettingsNavContent value="number-format">
          <NumberFormatPanel locale={locale} org={org} />
        </SettingsNavContent>
        <SettingsNavContent value="team">
          <TeamPanel locale={locale} members={members} currentUserId={session.userId} currentUserRole={session.role} />
        </SettingsNavContent>
        <SettingsNavContent value="roles-permissions">
          <RolesPermissionsPanel locale={locale} />
        </SettingsNavContent>
        {showZatca && (
          <SettingsNavContent value="zatca">
            <ZatcaPanel locale={locale} org={org} />
          </SettingsNavContent>
        )}
      </SettingsNav>
    </div>
  );
}
