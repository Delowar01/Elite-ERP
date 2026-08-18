"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, bankAccountsTable, accountsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { bankGlRefusal } from "@/lib/bank-gl-accounts";
import { bankOpeningEntryId, buildBankOpeningPosting, openingContraChoices, openingContraRefusal, writeBankOpeningEntry } from "@/lib/bank-opening";

export type ActionResult = { error?: string; id?: number };

const PATH = "/finance/bank-accounts";

// Optional payment-instruction fields shared by create + update. All trimmed; empty → null.
function readDetailFields(formData: FormData) {
  const s = (k: string) => String(formData.get(k) ?? "").trim() || null;
  return {
    bankName: s("bankName"),
    accountNumberMasked: s("accountNumberMasked"),
    accountHolder: s("accountHolder"),
    iban: s("iban"),
    swift: s("swift"),
    currency: s("currency"),
    branch: s("branch"),
  };
}

export async function createBankAccountAction(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  const glAccountId = Number(formData.get("glAccountId"));
  const openingBalance = String(formData.get("openingBalance") ?? "0").trim() || "0";
  const openingDate = String(formData.get("openingDate") ?? "").trim();
  const contraRaw = formData.get("openingContraAccountId");

  if (!name) return { error: "Account name is required." };
  if (Number.isNaN(glAccountId)) return { error: "Choose a linked GL account." };
  if (!Number.isFinite(Number(openingBalance))) return { error: "Opening balance must be a number." };

  const [glAccount] = await db
    .select({ id: accountsTable.id, code: accountsTable.code, name: accountsTable.name, type: accountsTable.type })
    .from(accountsTable)
    .where(and(eq(accountsTable.id, glAccountId), eq(accountsTable.orgId, session.orgId)));
  if (!glAccount) return { error: "GL account not found." };
  // The server decides, not the dropdown: linking a bank account to a control account posts every
  // receipt into that control account instead of a bank balance (see lib/bank-gl-accounts.ts).
  const refusal = bankGlRefusal(glAccount);
  if (refusal) return { error: refusal };

  // ── The opening balance is a POSTING, decided before anything is written ──────────────────────
  // Everything below refuses BEFORE the insert, so a bank account can never exist carrying an
  // opening balance whose entry failed to post — that combination is the defect this repair
  // removes, and it must not be reachable by a half-finished create.
  const wantsOpening = Number(openingBalance) !== 0;
  let contraAccountId: number | null = null;
  let posting: Awaited<ReturnType<typeof buildBankOpeningPosting>> | null = null;

  if (wantsOpening) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(openingDate)) {
      return { error: "An opening balance needs an as-of date — it is posted to the ledger on that date." };
    }
    if (openingDate > new Date().toISOString().slice(0, 10)) {
      return { error: "The opening date cannot be in the future." };
    }
    contraAccountId = Number(contraRaw);
    if (!Number.isInteger(contraAccountId)) return { error: "Choose where the opening balance came from." };
    const [contra] = await db
      .select({ id: accountsTable.id, code: accountsTable.code, name: accountsTable.name, type: accountsTable.type })
      .from(accountsTable)
      .where(and(eq(accountsTable.id, contraAccountId), eq(accountsTable.orgId, session.orgId)));
    if (!contra) return { error: "Contra account not found." };
    const contraRefusal = openingContraRefusal(contra);
    if (contraRefusal) return { error: contraRefusal };

    posting = await buildBankOpeningPosting({
      orgId: session.orgId,
      baseCurrency: session.orgCurrency,
      accountCurrency: String(formData.get("currency") ?? "").trim() || null,
      openingAmount: openingBalance,
      openingDate,
      glAccountId,
      contraAccountId,
    });
    if (!posting.ok) return { error: posting.error };
  }

  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(bankAccountsTable)
      .values({
        orgId: session.orgId,
        name,
        glAccountId,
        // An audit copy of what was typed. Nothing computes from it — see the schema comment.
        openingBalanceLegacy: openingBalance,
        openingDate: wantsOpening ? openingDate : null,
        openingContraAccountId: contraAccountId,
        ...readDetailFields(formData),
      })
      .returning({ id: bankAccountsTable.id });

    if (posting && posting.ok && !posting.skip) {
      await writeBankOpeningEntry(tx, {
        orgId: session.orgId,
        bankAccountId: created.id,
        entryDate: openingDate,
        memo: `Opening balance — ${name}`,
        createdById: session.userId,
        baseAmount: posting.baseAmount,
        debitAccountId: posting.debitAccountId,
        creditAccountId: posting.creditAccountId,
      });
    }
    return created;
  });

  await logActivity(session, {
    type: "bank_account.created",
    description: wantsOpening
      ? `Added bank account "${name}" with an opening balance of ${openingBalance} as of ${openingDate}`
      : `Added bank account "${name}"`,
    entityType: "bank_account",
    entityId: row.id,
  });
  revalidatePath(PATH);
  return { id: row.id };
}

// Edit an existing bank account. Tenant-scoped. This changes the master record only — saved
// documents keep the snapshot taken when they were saved, so they are unaffected.
export async function updateBankAccountAction(id: number, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!Number.isInteger(id)) return { error: "Invalid account." };
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Account name is required." };

  const [existing] = await db
    .select({ id: bankAccountsTable.id, glAccountId: bankAccountsTable.glAccountId })
    .from(bankAccountsTable)
    .where(and(eq(bankAccountsTable.id, id), eq(bankAccountsTable.orgId, session.orgId)));
  if (!existing) return { error: "Bank account not found." };

  // GL account + opening balance are optional on edit — keep the existing values when not supplied.
  const set: Record<string, unknown> = { name, ...readDetailFields(formData) };
  const glRaw = formData.get("glAccountId");
  if (glRaw != null && String(glRaw).trim() !== "") {
    const glAccountId = Number(glRaw);
    const [glAccount] = await db
      .select({ id: accountsTable.id, code: accountsTable.code, name: accountsTable.name, type: accountsTable.type })
      .from(accountsTable)
      .where(and(eq(accountsTable.id, glAccountId), eq(accountsTable.orgId, session.orgId)));
    if (!glAccount) return { error: "GL account not found." };
    // Refuse a CHANGE to an ineligible account, but let an unchanged legacy mapping through so the
    // other fields stay editable — the same rule the base-currency lock follows. Grandfathered bad
    // mappings are surfaced by scripts/audit-bank-gl-mappings.ts rather than by blocking edits.
    if (glAccountId !== existing.glAccountId) {
      const refusal = bankGlRefusal(glAccount);
      if (refusal) return { error: refusal };
    }
    set.glAccountId = glAccountId;
  }
  // ── The opening balance is IMMUTABLE once posted ─────────────────────────────────────────────
  // Same rule as a posted document. It stopped being a number on a record the moment it became a
  // journal entry, and a form field that quietly emits backdated ledger movements is the defect
  // this repair removed, wearing a different costume. The remedy for a wrong figure is the one the
  // ledger already has: a correcting journal entry — dated, attributable, and visible in every
  // report, none of which a silent field rewrite ever was.
  //
  // The edit dialog does not render these fields at all, so reaching this refusal means a replayed
  // or hand-built action. That is exactly the case worth refusing on the server.
  const openingRaw = formData.get("openingBalance");
  const openingDateRaw = formData.get("openingDate");
  const openingContraRaw = formData.get("openingContraAccountId");
  const touchesOpening = [openingRaw, openingDateRaw, openingContraRaw].some((v) => v != null && String(v).trim() !== "");
  if (touchesOpening) {
    const entryId = await bankOpeningEntryId(db, session.orgId, id);
    if (entryId !== null) {
      return {
        error:
          "This account's opening balance has been posted to the ledger and cannot be edited. " +
          "Correct it with a journal entry so the change is dated and visible in the reports.",
      };
    }
    // No entry yet — a zero-balance account, or a legacy row the backfill has not reached. Nothing
    // is protected, so the figure stays editable and is still only an audit copy.
    if (openingRaw != null && String(openingRaw).trim() !== "") set.openingBalanceLegacy = String(openingRaw).trim();
  }

  await db.update(bankAccountsTable).set(set).where(and(eq(bankAccountsTable.id, id), eq(bankAccountsTable.orgId, session.orgId)));

  await logActivity(session, {
    type: "bank_account.updated",
    description: `Edited bank account "${name}"`,
    entityType: "bank_account",
    entityId: id,
  });
  revalidatePath(PATH);
  return { id };
}

/**
 * Equity and liability accounts an opening balance may be credited to, for the create dialog.
 *
 * A server action rather than a page prop because the same dialog is mounted inside document
 * create/edit pages, and threading the chart of accounts through every one of those to populate a
 * field that only appears when someone types a non-zero opening balance would be a lot of plumbing
 * for a rare path. The server validates the choice regardless — this only decides what is offered.
 */
export async function openingContraOptionsAction(): Promise<{ id: number; code: string; name: string; type: string }[]> {
  const session = await requireSession();
  return openingContraChoices(db, session.orgId);
}
