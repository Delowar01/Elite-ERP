import "server-only";
import type { Tx } from "@/db";
import {
  accountsTable,
  DEFAULT_CHART_OF_ACCOUNTS,
  documentSequencesTable,
  DOCUMENT_TYPES,
  DEFAULT_SEQUENCES,
  taxPresetsTable,
  paymentTermPresetsTable,
  unitsTable,
  bankAccountsTable,
  departmentsTable,
  productCategoriesTable,
  leaveTypesTable,
  expenseCategoriesTable,
} from "@/db/schema";
import { getProfileByCountryName } from "@/lib/geo/country-profiles";

// Seeds the minimal defaults a new org needs to be immediately usable:
// chart of accounts, document numbering sequences, a starter cash bank account, and common presets.
//
// `country` is the org's country NAME as stored on `orgs.country`. It drives the seeded tax preset
// only. Before registration asked for a country, the rate here was hardcoded to Saudi Arabia's 15%
// and nobody could see it was wrong; now that the question is asked, ignoring the answer would be a
// visible defect on an org's first day.
export async function seedOrgDefaults(tx: Tx, orgId: number, country?: string | null) {
  const profile = getProfileByCountryName(country);
  const insertedAccounts = await tx
    .insert(accountsTable)
    .values(
      DEFAULT_CHART_OF_ACCOUNTS.map((a) => ({
        orgId,
        code: a.code,
        name: a.name,
        type: a.type,
        normalBalance: a.normalBalance,
        isSystem: a.isSystem,
      })),
    )
    .returning();

  const cashAccount = insertedAccounts.find((a) => a.code === "1000");

  await tx.insert(documentSequencesTable).values(
    DOCUMENT_TYPES.map((documentType) => ({
      orgId,
      documentType,
      prefix: DEFAULT_SEQUENCES[documentType],
      nextNumber: 1,
      padding: 4,
    })),
  );

  // Rate and wording both follow the country profile: "Standard VAT" at 15% in Saudi Arabia, 5% in
  // the UAE, and "Standard Tax" at 0% for the Global profile, whose tax system is unknown.
  await tx.insert(taxPresetsTable).values([
    { orgId, name: `Standard ${profile.taxName}`, ratePercent: String(profile.defaultTaxRate) },
    { orgId, name: "Zero-rated", ratePercent: "0" },
  ]);

  await tx.insert(paymentTermPresetsTable).values([
    { orgId, name: "Due on Receipt", netDays: 0 },
    { orgId, name: "Net 15", netDays: 15 },
    { orgId, name: "Net 30", netDays: 30 },
  ]);

  await tx.insert(unitsTable).values([
    { orgId, name: "Pieces", abbreviation: "pcs" },
    { orgId, name: "Hours", abbreviation: "hr" },
    { orgId, name: "Kilograms", abbreviation: "kg" },
  ]);

  if (cashAccount) {
    await tx.insert(bankAccountsTable).values({
      orgId,
      name: "Cash on Hand",
      glAccountId: cashAccount.id,
      openingBalanceLegacy: "0",
    });
  }

  await tx.insert(departmentsTable).values([
    { orgId, name: "Operations" },
    { orgId, name: "Finance" },
    { orgId, name: "Sales" },
  ]);

  await tx.insert(productCategoriesTable).values([
    { orgId, name: "Exhibition Stands" },
    { orgId, name: "Signage & Printing" },
    { orgId, name: "Furniture & Fixtures" },
  ]);

  await tx.insert(leaveTypesTable).values([
    { orgId, name: "Annual", daysPerYear: 21 },
    { orgId, name: "Sick", daysPerYear: 10 },
    { orgId, name: "Unpaid", daysPerYear: null },
  ]);

  await tx.insert(expenseCategoriesTable).values([
    { orgId, name: "Travel & Transport" },
    { orgId, name: "Office Supplies" },
    { orgId, name: "Equipment Rental" },
  ]);
}
