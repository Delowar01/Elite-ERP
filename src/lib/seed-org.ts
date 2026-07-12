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
} from "@/db/schema";

// Seeds the minimal defaults a new org needs to be immediately usable:
// chart of accounts, document numbering sequences, a starter cash bank account, and common presets.
export async function seedOrgDefaults(tx: Tx, orgId: number) {
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

  await tx.insert(taxPresetsTable).values([
    { orgId, name: "Standard VAT", ratePercent: "15" },
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
      openingBalance: "0",
    });
  }
}
